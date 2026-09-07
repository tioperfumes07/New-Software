/**
 * DISP-01 — two-event delivery revenue latch (ASC 606 earn-first).
 * §1.4 financial cluster · BUILD-AND-HOLD · INERT until REVENUE_RECOGNITION_POST_ENABLED is ON per entity.
 *
 * Event 1 (earn) at delivered / delivered_pending_docs:
 *   DR Unbilled Revenue (role unbilled_revenue) / CR Line-Haul Income (role revenue_default)
 * Event 2 (bill), fired from EITHER (a) dispatch reaching completed_docs_received OR (b) the load's
 * invoice being SENT (see invoice-send.service.ts's after-commit call) — OWNER DECISION B
 * (2026-08-27 23:00 CT): requires earn to exist AND a real, non-void, ISSUED invoice
 * (sent/partial/paid/factored — never draft/proforma-only). POD is no longer a condition of Event 2;
 * it remains required for factoring submission (factoring/submission-queue.service.ts, unchanged).
 *   DR A/R (role ar_control) / CR Unbilled Revenue
 *
 * WRITES ZERO NEW GL MATH — every entry goes through createJournalEntry (debits===credits) and
 * resolveRoleAccount (no hardcoded account numbers). TRK excluded (42000-LEASE).
 *
 * When this latch is ON for an entity, keep INVOICE_AR_GL_POSTING_ENABLED OFF for load-sourced
 * invoices (or extend the invoice poster to skip income credit) — otherwise bill-first A/R would
 * double-recognize revenue. Coordination is owner-gated; both flags default OFF.
 */

import { withLuciaBypass } from "../../auth/db.js";
import { isEnabled } from "../../lib/feature-flags/service.js";
import { createJournalEntry } from "../journal-entries.service.js";
import { resolveRoleAccount } from "../coa-roles/resolver.service.js";
import { appendCrudAudit } from "../../audit/crud-audit.js";
import { writeTransactionSourceLink } from "../accounting-spine-emit.js";
import { enqueueAfterCommit } from "../../lib/after-commit.js";
import { companyBusinessDate } from "../../lib/company-business-date.js";

export const REVENUE_RECOGNITION_POST_FLAG = "REVENUE_RECOGNITION_POST_ENABLED";

export type RevrecEvent = "earn" | "bill";

type DbClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

type Posting = {
  account_id: string;
  debit_or_credit: "debit" | "credit";
  amount_cents: number;
  description?: string | null;
};

export type RevrecPostResult = {
  posted: boolean;
  reason?:
    | "flag_off"
    | "trk_excluded"
    | "wrong_status"
    | "already_posted"
    | "zero_amount"
    | "load_not_found"
    | "earn_missing_for_bill"
    | "amount_mismatch"
    | "missing_delivery_evidence"
    // OWNER DECISION B (2026-08-27 23:00 CT, docs/lockdown/OWNER-DECISION-ACCT-F5692-OPTION-B-2026-08-27.md)
    // — replaces "missing_pod_evidence". Event 2 no longer requires POD; it requires a real, non-void,
    // ISSUED invoice for the load (sent/partial/paid — never draft/proforma-only). See
    // loadHasIssuedInvoice below.
    | "missing_issued_invoice"
    // ACCT-F59 reverse interlock — an invoice already recognized this load's revenue/A-R. Distinct
    // from "already_posted" on purpose: that one means THIS latch fired, this one means the OTHER
    // poster did, and conflating them would hide which path double-counted.
    | "invoice_gl_already_recognized"
    | "latch_table_missing";
  journal_entry_id?: string;
  event?: RevrecEvent;
  memo?: string;
};

const FLAG_OFF: RevrecPostResult = { posted: false, reason: "flag_off" };
const LATCH_REGCLASS = "accounting.load_revenue_recognition_postings";

/** Fail closed until owner Neon-applies 202609290000 — never 42P01 on a money path. */
async function latchTablePresent(client: DbClient): Promise<boolean> {
  const res = await client.query<{ ok: boolean }>(
    `SELECT to_regclass($1::text) IS NOT NULL AS ok`,
    [LATCH_REGCLASS]
  );
  return Boolean(res.rows[0]?.ok);
}

/** Event 1 — DR Unbilled / CR Line-Haul. Balanced by construction. */
export function buildEarnEvent1Postings(
  unbilledAccountId: string,
  revenueAccountId: string,
  amountCents: number,
  memo: string
): Posting[] {
  return [
    {
      account_id: unbilledAccountId,
      debit_or_credit: "debit",
      amount_cents: amountCents,
      description: `${memo} — Unbilled Revenue`,
    },
    {
      account_id: revenueAccountId,
      debit_or_credit: "credit",
      amount_cents: amountCents,
      description: `${memo} — Line-Haul Income`,
    },
  ];
}

/** Event 2 — DR A/R / CR Unbilled. Balanced by construction. */
export function buildBillEvent2Postings(
  arAccountId: string,
  unbilledAccountId: string,
  amountCents: number,
  memo: string
): Posting[] {
  return [
    {
      account_id: arAccountId,
      debit_or_credit: "debit",
      amount_cents: amountCents,
      description: `${memo} — A/R`,
    },
    {
      account_id: unbilledAccountId,
      debit_or_credit: "credit",
      amount_cents: amountCents,
      description: `${memo} — relieve Unbilled Revenue`,
    },
  ];
}

async function postingEnabled(client: DbClient, operatingCompanyId: string): Promise<boolean> {
  return isEnabled(client as never, REVENUE_RECOGNITION_POST_FLAG, {
    operating_company_id: operatingCompanyId,
  });
}

async function companyCode(client: DbClient, operatingCompanyId: string): Promise<string | null> {
  const res = await client.query<{ code: string }>(
    `SELECT code::text AS code FROM org.companies WHERE id = $1::uuid LIMIT 1`,
    [operatingCompanyId]
  );
  return res.rows[0]?.code ?? null;
}

/**
 * ACCT-F66 — a latch row is only STANDING while the journal entry it recorded still stands.
 *
 * accounting.load_revenue_recognition_postings is INSERT-only in practice: nothing ever set
 * is_active=false, even though the table was built with is_active / voided_at / voided_by_user_id and
 * ih35_app holds UPDATE but NOT DELETE. So when the two 2026-08-01 owner-authorized reversals zeroed
 * load L-20260624-0083's GL (net 0 across 1240 Unbilled, 4100 Freight Revenue and QBO-45 A/R), the
 * subledger rows stayed is_active=true, status='posted'. Verified on prod: both rows still active,
 * while their journal entries carry reversed_by_je_id = a5123c01-… and 363f13ae-….
 *
 * Consequences of treating a reversed latch as standing, all real:
 *   - loadLatchExists() returns true, so the load can NEVER re-recognize. If the delivery is later
 *     genuinely evidenced, Event 1 refuses with "already_posted" and the revenue is lost silently.
 *   - earnAmountCents() would feed Event 2 an amount from a reversed Event 1.
 *   - the ACCT-F59 invoice interlock would refuse that load's invoice forever.
 *
 * The reversal linkage is already modelled and populated (journal_entries.reversed_by_je_id /
 * voided_at), so this is declarative — no hook on every reversal path that could be missed. ONE
 * definition, exported, used by every caller: the repo has already shipped a load state machine in
 * three copies and a revenue rule in two, and this is the same failure waiting to happen.
 */
export function standingLatchJePredicate(alias = "p"): string {
  return `EXISTS (
    SELECT 1 FROM accounting.journal_entries je
    WHERE je.id = ${alias}.journal_entry_id
      AND je.operating_company_id = ${alias}.operating_company_id
      AND je.voided_at IS NULL
      AND je.reversed_by_je_id IS NULL
  )`;
}

/** Default-alias form for the common `... postings p` shape. */
export const STANDING_LATCH_JE_PREDICATE = standingLatchJePredicate("p");

/**
 * ACCT-F59 reverse interlock: has an INVOICE for this load already put revenue/A-R on the books?
 *
 * Mirror image of loadHasStandingInvoiceGl's counterpart in invoice-gl.service.ts, and it reuses the
 * SAME standing-JE test — a reversed or voided invoice JE must NOT block recognition forever, which is
 * the ACCT-F59 trap that the forward interlock already had to learn.
 *
 * Linkage is `accounting.transaction_source_links` (linked_object_type='invoice'), the canonical
 * posting→source map the posting engine writes. Verified on prod against the real double: JE 7f2fff09
 * links to invoice f17a6483 with relationship_role='source_transaction'. NOTE `linked_object_id` is
 * TEXT, not uuid — the cast is required, and joining without it raises 42883 rather than silently
 * matching nothing.
 */
async function loadHasStandingInvoiceGl(
  client: DbClient,
  operatingCompanyId: string,
  loadId: string
): Promise<string | null> {
  const res = await client.query<{ invoice_id: string }>(
    `
      SELECT i.id::text AS invoice_id
        FROM accounting.invoices i
        JOIN accounting.transaction_source_links l
          ON l.linked_object_id = i.id::text
         AND l.linked_object_type = 'invoice'
        JOIN accounting.journal_entry_postings p ON p.id = l.journal_entry_posting_id
        JOIN accounting.journal_entries je ON je.id = p.journal_entry_uuid
         AND je.operating_company_id = i.operating_company_id
       WHERE i.source_load_id = $1::uuid
         AND i.operating_company_id = $2::uuid
         AND i.voided_at IS NULL
         AND je.voided_at IS NULL
         AND je.reversed_by_je_id IS NULL
       LIMIT 1
    `,
    [loadId, operatingCompanyId]
  );
  return res.rows[0]?.invoice_id ?? null;
}

/**
 * OWNER DECISION B evidence gate for Event 2 (2026-08-27 23:00 CT,
 * docs/lockdown/OWNER-DECISION-ACCT-F5692-OPTION-B-2026-08-27.md).
 *
 * ACCT-F5692's hasApprovedPodEvidence() gate is REMOVED as a posting BLOCK (dispatch.pod_documents is
 * 0 rows system-wide — the gate could never open). Owner-ruled replacement matches QBO/NetSuite/McLeod:
 * the BILL/INVOICE creates the receivable; POD gates COLLECTION/FACTORING
 * (factoring/submission-queue.service.ts's own independent has_approved_pod check is UNCHANGED), not
 * A/R recognition. So Event 2's evidence requirement becomes "a real invoice was actually issued to
 * the customer for this load" — never draft/proforma alone, since those are non-posting projections
 * the customer never saw.
 *
 * 'factored' is included even though the owner packet enumerates sent/partial/paid: per
 * invoices-bulk.routes.ts's own note, 'factored' is reachable ONLY from 'sent', so it is strictly a
 * superset of "issued", never a lesser state — excluding it would only create a gap for an
 * already-factored invoice being reprocessed.
 */
async function loadHasIssuedInvoice(
  client: DbClient,
  operatingCompanyId: string,
  loadId: string
): Promise<boolean> {
  const res = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM accounting.invoices
      WHERE source_load_id = $1::uuid
        AND operating_company_id = $2::uuid
        AND voided_at IS NULL
        AND status IN ('sent', 'partial', 'paid', 'factored')
      LIMIT 1
    `,
    [loadId, operatingCompanyId]
  );
  return Boolean(res.rows[0]?.id);
}

async function loadLatchExists(
  client: DbClient,
  operatingCompanyId: string,
  loadId: string,
  event: RevrecEvent
): Promise<boolean> {
  const res = await client.query<{ id: string }>(
    `
      SELECT p.id::text
      FROM accounting.load_revenue_recognition_postings p
      WHERE p.operating_company_id = $1::uuid
        AND p.load_id = $2::uuid
        AND p.event = $3
        AND p.is_active
        AND ${STANDING_LATCH_JE_PREDICATE}
      LIMIT 1
    `,
    [operatingCompanyId, loadId, event]
  );
  return Boolean(res.rows[0]?.id);
}

// ACCT-F5692 — Event 2 (bill, target status literally named `completed_docs_received`) had no check
// that a completion document actually exists. Live-verified on prod 2026-08-21: dispatch.pod_documents
// is 0 rows system-wide while 3 USMCA loads (one real money, is_sample_data=false, $1,875.50) already
// sit in completed_docs_received with a posted `bill` JE (DR A/R / CR Unbilled) — a receivable booked
// on paperwork that provably does not exist. Mirrors the exact gate the factoring submission queue
// already uses to decide POD-eligibility (submission-queue.service.ts `has_approved_pod`): an
// `approved`, non-archived dispatch.pod_documents row for this load.
//
// OWNER DECISION B (2026-08-27 23:00 CT) — this check is NO LONGER a posting gate on Event 2; Event
// 2's evidence requirement is now loadHasIssuedInvoice() above. This function is kept EXPORTED so a
// DETECTOR ("invoiced_without_approved_pod", tracked for CC-2's _system.reconciliation_findings
// infrastructure) can flag a bill-event posting made without POD evidence, without blocking the
// posting itself. submission-queue.service.ts's own independent has_approved_pod check is UNCHANGED —
// factoring submission still requires real POD.
export async function hasApprovedPodEvidence(
  client: DbClient,
  operatingCompanyId: string,
  loadId: string
): Promise<boolean> {
  const res = await client.query<{ exists: boolean }>(
    `
      SELECT true AS exists
      FROM dispatch.pod_documents pd
      WHERE pd.load_id = $1::uuid
        AND pd.operating_company_id = $2::uuid
        AND pd.status = 'approved'
        AND pd.archived_at IS NULL
      LIMIT 1
    `,
    [loadId, operatingCompanyId]
  );
  return Boolean(res.rows[0]?.exists);
}

async function earnAmountCents(
  client: DbClient,
  operatingCompanyId: string,
  loadId: string
): Promise<number | null> {
  const res = await client.query<{ amount_cents: string | number }>(
    `
      SELECT p.amount_cents
      FROM accounting.load_revenue_recognition_postings p
      WHERE p.operating_company_id = $1::uuid
        AND p.load_id = $2::uuid
        AND p.event = 'earn'
        AND p.is_active
        AND ${STANDING_LATCH_JE_PREDICATE}
      LIMIT 1
    `,
    [operatingCompanyId, loadId]
  );
  if (!res.rows[0]) return null;
  return Number(res.rows[0].amount_cents);
}

type LoadRow = {
  id: string;
  status: string;
  rate_total_cents: number;
  display_id: string | null;
  /** ACCT-F210 — the load's sample flag, carried into every JE this poster creates. */
  is_sample_data: boolean;
};

async function loadLoad(client: DbClient, operatingCompanyId: string, loadId: string): Promise<LoadRow | null> {
  const res = await client.query<{
    id: string;
    status: string;
    rate_total_cents: string | number | null;
    display_id: string | null;
    is_sample_data: boolean;
  }>(
    `
      SELECT id::text AS id,
             status::text AS status,
             rate_total_cents,
             load_number::text AS display_id,
             -- ACCT-F210: carry the load's sample flag into the GL. FAIL-D6 made the load taggable
             -- and the invoice/settlement paths already inherit it; without this the revenue JEs of a
             -- SAMPLE load stayed untagged, and the GL is what financial statements are built from.
             COALESCE(is_sample_data, false) AS is_sample_data
      FROM mdata.loads
      WHERE operating_company_id = $1::uuid
        AND id = $2::uuid
        AND soft_deleted_at IS NULL
      LIMIT 1
    `,
    [operatingCompanyId, loadId]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    rate_total_cents: Number(row.rate_total_cents ?? 0),
    display_id: row.display_id,
    is_sample_data: row.is_sample_data === true,
  };
}

export type PostLoadRevenueLatchInput = {
  operating_company_id: string;
  load_id: string;
  /** Dispatch target status that triggered this call. */
  target_status: string;
  entry_date_iso: string;
  actor_user_id: string;
};

/**
 * EVIDENCE GATE (owner-approved Option B, 2026-08-01) — recognition is EVIDENCE-driven, never
 * status-driven.
 *
 * Event 1 may only earn when the FINAL ACTIVE delivery stop carries a real `actual_departure_at`,
 * which the CPA decision (§5 / blueprint §18) names as the recognition source. Load STATUS is
 * deliberately NOT sufficient: `mdata.loads.status` is written from 8 separate code paths, three of
 * which can reach `delivered_pending_docs`+ by validating only a status graph without ever reading
 * `mdata.load_stops`. The inversion this closes is exact — the only path that CAPTURES delivery
 * evidence (driver arrive/depart) never triggers this latch, and the only path that DOES trigger it
 * (the office transition endpoint) captures no evidence.
 *
 * The gate lives HERE, in the poster, rather than in any caller, so it holds no matter which of the
 * status writers fires the latch now or later.
 *
 * "Final active" = highest `sequence_number` among delivery stops that are neither `cancelled` nor
 * soft-deleted. Ordering by sequence is what makes a multi-drop load earn at the LAST drop rather
 * than the first. Returns the timestamp when the evidence exists, otherwise null.
 *
 * Deliberately NOT a hard block on the dispatch workflow: a load with no evidence simply does not
 * recognize (a visible, correctable exception). Blocking the status transition instead would create
 * pressure to type a fabricated delivery time to unblock billing, and a fabricated timestamp under a
 * revenue entry is far more dangerous than an unrecognized load.
 */
export async function finalActiveDeliveryDepartureAt(
  client: DbClient,
  operatingCompanyId: string,
  loadId: string
): Promise<string | null> {
  const res = await client.query<{ actual_departure_at: string | null }>(
    `
      SELECT s.actual_departure_at::text AS actual_departure_at
      FROM mdata.load_stops s
      JOIN mdata.loads l ON l.id = s.load_id
      WHERE s.load_id = $1::uuid
        AND l.operating_company_id = $2::uuid
        AND s.stop_type::text = 'delivery'
        AND s.status::text <> 'cancelled'
        AND s.soft_deleted_at IS NULL
      ORDER BY s.sequence_number DESC
      LIMIT 1
    `,
    [loadId, operatingCompanyId]
  );
  return res.rows[0]?.actual_departure_at ?? null;
}

/**
 * MANUAL-DELIVERY-AUTH-01 (owner request 2026-09-07) -- some customer + factoring agreements permit
 * invoicing/factoring a load before the truck is physically empty, with a signed POD/BOL already in
 * hand. This does NOT touch finalActiveDeliveryDepartureAt or fabricate stop data -- it is a SEPARATE,
 * explicit, reason-required authorization record (dispatch.manual_delivery_authorizations, created
 * only via POST /api/v1/dispatch/loads/:loadId/manual-delivery-authorization, role-gated, requires
 * both customer_authorized and factoring_authorized). Returns the authorization's own timestamp
 * (never a fabricated stop time) when an ACTIVE (non-revoked) authorization exists for this load,
 * otherwise null. Callers that use this to satisfy the Event 1 earn gate MUST tag the resulting JE
 * memo distinctly (see `earn` branch below) so a manually-authorized posting is never silently
 * indistinguishable from one backed by real delivery evidence.
 */
async function activeManualDeliveryAuthorizationAt(
  client: DbClient,
  operatingCompanyId: string,
  loadId: string
): Promise<string | null> {
  const res = await client.query<{ authorized_at: string | null }>(
    `
      SELECT authorized_at::text AS authorized_at
      FROM dispatch.manual_delivery_authorizations
      WHERE load_id = $1::uuid
        AND operating_company_id = $2::uuid
        AND revoked_at IS NULL
      ORDER BY authorized_at DESC
      LIMIT 1
    `,
    [loadId, operatingCompanyId]
  );
  return res.rows[0]?.authorized_at ?? null;
}

function resolveEvent(targetStatus: string): RevrecEvent | null {
  // Dispatch machine uses delivered_pending_docs (not a separate "delivered") for earn.
  if (targetStatus === "delivered" || targetStatus === "delivered_pending_docs") return "earn";
  if (targetStatus === "completed_docs_received") return "bill";
  return null;
}

/**
 * Post Event 1 or Event 2 for a load status transition. INERT while flag OFF.
 */
export async function postLoadRevenueLatch(input: PostLoadRevenueLatchInput): Promise<RevrecPostResult> {
  const event = resolveEvent(input.target_status);
  if (!event) return { posted: false, reason: "wrong_status" };

  const prepared = await withLuciaBypass(async (client: DbClient) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [
      input.operating_company_id,
    ]);
    if (!(await postingEnabled(client, input.operating_company_id))) return { gate: "flag_off" as const };

    // to_regclass('accounting.load_revenue_recognition_postings') — phantom-relation skip + fail-closed
    if (!(await latchTablePresent(client))) return { gate: "latch_table_missing" as const };

    const code = await companyCode(client, input.operating_company_id);
    if (code === "TRK") return { gate: "trk_excluded" as const };

    const load = await loadLoad(client, input.operating_company_id, input.load_id);
    if (!load) return { gate: "load_not_found" as const };

    if (await loadLatchExists(client, input.operating_company_id, input.load_id, event)) {
      return { gate: "already_posted" as const };
    }

    // ACCT-F59 / FAIL-A1 — THE OTHER DIRECTION. The invoice poster already refuses when this latch has
    // fired (loadHasStandingBillLatch, ACCT-F205). Nothing refused the reverse, and the reverse is the
    // one that actually happened: on prod, JE 7f2fff09 (source `invoice`, INV-2026-00006) posted at
    // 07:14:33.413 and f19cdf41 (this latch's Event 1 earn) at 07:14:33.836 — 423ms later. The invoice
    // went FIRST.
    //
    // CORRECTED 2026-08-28 (GO-2228/ACCT-F59, this comment was stale) — the invoice-side duplicate
    // (7f2fff09) WAS since reversed: JE aaad9534, memo "Void reversal of invoice ...: ACCT-F59:
    // duplicate revenue — invoice". What remained standing after that reversal was the OTHER half —
    // this latch's own Event 2 "bill" JEs (a5aa127d/d147470a/98e299dc, DR ar_control/CR
    // unbilled_revenue) for the same class of double-counted loads — since the invoice poster refusing
    // to fire going-forward does not retroactively undo a bill JE that already posted. Those three were
    // reversed via voidJournalEntry (the same reversing-JE mechanism, no new GL math) on 2026-08-28,
    // returning $9,995.50 from A/R (1100) to Unbilled Revenue (1150) — correct, since Event 1 revenue
    // still stands and the loads are earned-not-billed now that their invoice-side A/R was reversed.
    //
    // A one-directional interlock is still not an interlock on its own — it is a coin flip on ordering.
    // This gate (loadHasStandingInvoiceGl below) is what closes the reverse direction going forward;
    // the three historical bill JEs above were the one-time cleanup for postings made before this gate
    // existed.
    const invoicePostedLoad = await loadHasStandingInvoiceGl(
      client,
      input.operating_company_id,
      input.load_id
    );
    if (invoicePostedLoad) return { gate: "invoice_gl_already_recognized" as const };

    // Event 1 earns on real captured delivery evidence, OR an explicit, on-the-record manual
    // delivery authorization (MANUAL-DELIVERY-AUTH-01) — never on status alone, never silently.
    let manualAuthEvidence = false;
    if (event === "earn") {
      const departedAt = await finalActiveDeliveryDepartureAt(
        client,
        input.operating_company_id,
        input.load_id
      );
      if (!departedAt) {
        const authorizedAt = await activeManualDeliveryAuthorizationAt(
          client,
          input.operating_company_id,
          input.load_id
        );
        if (!authorizedAt) return { gate: "missing_delivery_evidence" as const };
        manualAuthEvidence = true;
      }
    }

    let amount = load.rate_total_cents;
    if (event === "bill") {
      const earnAmt = await earnAmountCents(client, input.operating_company_id, input.load_id);
      if (earnAmt == null) return { gate: "earn_missing_for_bill" as const };
      amount = earnAmt;

      // OWNER DECISION B evidence gate (see loadHasIssuedInvoice's header comment above) — Event 2
      // requires a real, non-void, ISSUED invoice (sent/partial/paid/factored), never draft/proforma
      // alone. This replaces ACCT-F5692's hasApprovedPodEvidence() gate as the posting block.
      const issuedInvoice = await loadHasIssuedInvoice(client, input.operating_company_id, input.load_id);
      if (!issuedInvoice) return { gate: "missing_issued_invoice" as const };
    }
    if (amount <= 0) return { gate: "zero_amount" as const };

    const label = load.display_id ?? load.id;
    const memo =
      event === "earn"
        ? manualAuthEvidence
          ? `Revrec Event 1 earn — load ${label} [${load.id}] (MANUAL DELIVERY AUTHORIZATION — pre-delivery, customer+factoring authorized, see dispatch.manual_delivery_authorizations)`
          : `Revrec Event 1 earn — load ${label} [${load.id}]`
        : `Revrec Event 2 bill — load ${label} [${load.id}]`;

    const unbilledAccountId = await resolveRoleAccount(client, input.operating_company_id, "unbilled_revenue");
    let postings: Posting[];
    if (event === "earn") {
      const revenueAccountId = await resolveRoleAccount(client, input.operating_company_id, "revenue_default");
      postings = buildEarnEvent1Postings(unbilledAccountId, revenueAccountId, amount, memo);
    } else {
      const arAccountId = await resolveRoleAccount(client, input.operating_company_id, "ar_control");
      postings = buildBillEvent2Postings(arAccountId, unbilledAccountId, amount, memo);
    }

    return {
      gate: "post" as const,
      event,
      memo,
      amount,
      entryDate: input.entry_date_iso.slice(0, 10),
      // ACCT-F210 — read from the LOAD, never from a memo or load-number string match.
      isSampleData: load.is_sample_data,
      postings,
    };
  });

  if (prepared.gate === "flag_off") return FLAG_OFF;
  if (prepared.gate === "latch_table_missing") return { posted: false, reason: "latch_table_missing" };
  if (prepared.gate === "trk_excluded") return { posted: false, reason: "trk_excluded" };
  if (prepared.gate === "load_not_found") return { posted: false, reason: "load_not_found" };
  if (prepared.gate === "already_posted") return { posted: false, reason: "already_posted" };
  if (prepared.gate === "invoice_gl_already_recognized") {
    return { posted: false, reason: "invoice_gl_already_recognized" };
  }
  if (prepared.gate === "earn_missing_for_bill") return { posted: false, reason: "earn_missing_for_bill" };
  if (prepared.gate === "missing_issued_invoice") return { posted: false, reason: "missing_issued_invoice" };
  if (prepared.gate === "missing_delivery_evidence") return { posted: false, reason: "missing_delivery_evidence" };
  if (prepared.gate === "zero_amount") return { posted: false, reason: "zero_amount" };

  const created = await createJournalEntry(
    {
      operating_company_id: input.operating_company_id,
      entry_date: prepared.entryDate,
      memo: prepared.memo,
      source: "auto",
      // ACCT-F210 — the GL inherits the load's sample flag, exactly as the invoice and settlement
      // paths already do. One source of truth: the load. Never derived from a memo string.
      is_sample_data: prepared.isSampleData,
      postings: prepared.postings,
    },
    { userId: input.actor_user_id, role: "system" }
  );

  await withLuciaBypass(async (client: DbClient) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [
      input.operating_company_id,
    ]);
    const postingRes = await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM accounting.journal_entry_postings
        WHERE journal_entry_uuid = $1::uuid
        ORDER BY line_sequence ASC NULLS LAST, created_at ASC
        LIMIT 1
      `,
      [created.id]
    );
    const postingId = postingRes.rows[0]?.id;
    if (postingId) {
      await writeTransactionSourceLink(client as never, {
        operating_company_id: input.operating_company_id,
        journal_entry_posting_id: postingId,
        linked_object_type: "load",
        linked_object_id: input.load_id,
        relationship_role: prepared.event === "earn" ? "revrec_earn" : "revrec_bill",
      });

      // INVOICE-SENT-WITHOUT-AR-RECOGNITION-JE (reconciliation-gap half) — Event 2's DR A/R leg IS
      // economically the invoice's own A/R: the invoice poster (posting-engine.service.ts) REFUSES
      // to post its own A/R+revenue JE whenever this latch owns the load (see
      // InvoiceRevrecLatchOwnsLoadError — "The invoice's A/R belongs to latch Event 2 ... do not
      // post around it"). Leaving this posting's source_transaction_type/source_transaction_id NULL
      // meant the invoice detail page's own JE lookup, account-register.service.ts, and any
      // GL<->sub-ledger tie-out could never find this JE via its invoice — confirmed live: the
      // Balance Sheet 1100 A/R control account and /reports/ar-aging silently diverged by exactly
      // the sum of untagged Event-2 legs. Tag it here, the same structured
      // source_transaction_type/source_transaction_id column pair every other money path
      // (bank_categorization, customer_payment, bill_payment, ...) already uses — only for the bill
      // (A/R) leg, and only when an invoice link is resolvable for this load.
      if (prepared.event === "bill") {
        const invoiceRes = await client.query<{ id: string }>(
          `
            SELECT id::text
            FROM accounting.invoices
            WHERE source_load_id = $1::uuid
              AND operating_company_id = $2::uuid
              AND voided_at IS NULL
            ORDER BY created_at ASC
            LIMIT 1
          `,
          [input.load_id, input.operating_company_id]
        );
        const invoiceId = invoiceRes.rows[0]?.id;
        if (invoiceId) {
          await client.query(
            `
              UPDATE accounting.journal_entry_postings
              SET source_transaction_type = 'invoice', source_transaction_id = $2
              WHERE id = $1::uuid
                AND source_transaction_type IS NULL
            `,
            [postingId, invoiceId]
          );
        }
      }
    }
    await client.query(
      `
        INSERT INTO accounting.load_revenue_recognition_postings (
          operating_company_id, load_id, event, journal_entry_id, amount_cents, entry_date, memo,
          status, created_by_user_id
        )
        VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6::date, $7, 'posted', $8::uuid)
        ON CONFLICT (operating_company_id, load_id, event) WHERE is_active DO NOTHING
      `,
      [
        input.operating_company_id,
        input.load_id,
        prepared.event,
        created.id,
        prepared.amount,
        prepared.entryDate,
        prepared.memo,
        input.actor_user_id,
      ]
    );
    await appendCrudAudit(
      client as Parameters<typeof appendCrudAudit>[0],
      input.actor_user_id,
      prepared.event === "earn" ? "accounting.revrec.earn.posted" : "accounting.revrec.bill.posted",
      {
        resource_type: "mdata.loads",
        resource_id: input.load_id,
        operatingCompanyId: input.operating_company_id,
        journalEntryId: created.id,
        amount_cents: prepared.amount,
        entry_date: prepared.entryDate,
        event: prepared.event,
      },
      "warning"
    );
  });

  return {
    posted: true,
    journal_entry_id: created.id,
    event: prepared.event,
    memo: prepared.memo,
  };
}

export type FireRevrecLatchOnInvoiceIssuedInput = {
  operating_company_id: string;
  source_load_id: string;
  actor_user_id: string;
  invoice_id: string;
};

/**
 * GO-0014 event2-silent-on-issued-invoices — OWNER DECISION B's trigger
 * (docs/lockdown/OWNER-DECISION-ACCT-F5692-OPTION-B-2026-08-27.md) was wired into
 * invoice-send.service.ts's single-invoice /send path only. accounting/invoices-bulk.routes.ts's
 * `mark_sent` action and its `set_status` action (which can also land an invoice directly on
 * 'paid'/'factored') set the SAME issued statuses `loadHasIssuedInvoice` reads, through a completely
 * separate code path that never called postLoadRevenueLatch at all -- a load bulk-marked sent (or
 * bulk-set straight to paid/factored) never got its Event 2 (DR A/R / CR Unbilled) JE, silently,
 * with no error and no audit row naming the gap, exactly the "invisible by construction" shape
 * LV-REVREC-NOT-FIRING (see lib/after-commit.ts) already named once for Event 1.
 *
 * §9.0.17 — ONE helper for this trigger, extracted out of invoice-send.service.ts's original inline
 * block (byte-identical behavior) so every current and future call site shares it instead of
 * re-copying the enqueue/fire/swallow-log shape per writer. Does NOT invent a second A/R poster --
 * this calls the exact same postLoadRevenueLatch Event 2 already uses; the latch's own gates
 * (already_posted, earn_missing_for_bill, missing_issued_invoice, ...) decide whether it actually
 * posts, so calling this from a status writer that turns out not to be evidence-complete is a
 * documented no-op, never a double-post.
 *
 * After-commit, same reasoning as firePostLoadRevenueLatch in delivery-evidence-latch.ts: the poster
 * opens its OWN connection via withLuciaBypass and must not race the caller's own status-write
 * transaction. Swallow-and-log: a latch failure must never fail an invoice status change that
 * already succeeded (invoice-send.service.ts's existing before/after commit reasoning, unchanged).
 */
export async function fireRevrecLatchOnInvoiceIssued(
  client: object,
  input: FireRevrecLatchOnInvoiceIssuedInput
): Promise<void> {
  const fire = async () => {
    try {
      await postLoadRevenueLatch({
        operating_company_id: input.operating_company_id,
        load_id: input.source_load_id,
        // resolveEvent() maps this literal to the "bill" event; postLoadRevenueLatch's own gates
        // decide whether it actually posts -- this trigger does not assert the load's real dispatch
        // status, same as every other call site of this helper.
        target_status: "completed_docs_received",
        entry_date_iso: companyBusinessDate(),
        actor_user_id: input.actor_user_id,
      });
    } catch (err) {
      console.warn(
        { err, invoice_id: input.invoice_id, load_id: input.source_load_id },
        "acct_option_b_revrec_latch_on_send_failed"
      );
    }
  };
  if (!enqueueAfterCommit(client, { label: `revrec-latch-on-send:${input.invoice_id}`, run: fire })) {
    await fire();
  }
}
