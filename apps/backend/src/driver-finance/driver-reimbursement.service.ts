// Driver REIMBURSEMENT service — out-of-pocket toll/fuel pay-outs (hire-contract item 5).
// TIER-1 FINANCIAL, BUILD-AND-HOLD. A reimbursement is money the COMPANY owes the DRIVER — the opposite of
// a cash advance (a receivable). Two pay modes:
//   * 'settlement' (default): rides the next settlement close as a reimbursement pay line
//     (computeSettlementReimbursements in settlement-contract-terms.service.ts).
//   * 'immediate': pays NOW, WITHOUT waiting for a settlement — flips status pending -> paid and (when the
//     REIMBURSEMENT_GL_POSTING_ENABLED per-entity flag is ON) posts a balanced JE via the EXISTING posting
//     engine ('driver_reimbursement' source type): Dr reimbursement_expense / Cr cash. Mirrors the two-phase
//     driver_advance disburse. NO new GL math — reuses postSourceTransaction.
//
// The immediate GL post is per-entity OFF by default (money-posting flag). With it OFF the pay-out still
// records (status='paid', journal_entry_id NULL) so the claim is settled operationally; the GL leg posts
// once Jorge flips the flag (TRANSP first). Void-not-delete: cancel sets status='void'.

import { withCurrentUser } from "../auth/db.js";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { isOwnerOrAdmin } from "../bulk/bulk-update.factory.js";
import { isEnabled } from "../lib/feature-flags/service.js";
import { postSourceTransactionInClientTx } from "../accounting/posting-engine.service.js";
import { updateBankBalance } from "../accounting/bills.service.js";
import { logger } from "../observability/structured-logger.js";
import { materializeSettlementLines } from "./settlement-lines-materialize.service.js";

/** Per-entity money-posting flag (auto-classified per-entity-only by the `_GL_POSTING_ENABLED` pattern). */
export const REIMBURSEMENT_GL_POSTING_FLAG = "REIMBURSEMENT_GL_POSTING_ENABLED";

const AUDIT_TAG = "SETTLEMENT-CONTRACT-TERMS-REIMBURSEMENT";

type PgishClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type CreateDriverReimbursementInput = {
  driver_id: string;
  amount_cents: number;
  reimbursement_type: "toll" | "fuel" | "scale" | "parking" | "lumper" | "other";
  reason: string;
  load_id?: string | null;
  pay_mode?: "immediate" | "settlement";
  evidence_doc_id?: string | null;
  // ACCT-F5687 — the bank the 'immediate' pay-out will credit at post time (resolved via the same
  // bank->GL bridge every other bank-facing poster uses). Optional/nullable: a reimbursement that
  // never names a bank still posts, via the ACCT-F345 fail-closed company default.
  from_bank_account_id?: string | null;
};

export type CreateDriverReimbursementResult =
  | { ok: true; reimbursementId: string }
  | { ok: false; code: number; error: string };

/**
 * Book a driver reimbursement claim (status='pending'). Call inside a transaction with
 * app.operating_company_id already set. Does NOT post — payment happens via
 * payDriverReimbursementImmediately (immediate) or the settlement close (settlement mode).
 */
export async function createDriverReimbursementCore(
  client: PgishClient,
  actorUserUuid: string,
  companyId: string,
  body: CreateDriverReimbursementInput
): Promise<CreateDriverReimbursementResult> {
  if (!Number.isInteger(body.amount_cents) || body.amount_cents <= 0) {
    return { ok: false, code: 400, error: "amount_cents must be a positive integer" };
  }
  if (!body.reason?.trim()) return { ok: false, code: 400, error: "reason is required" };

  const driverRes = await client.query(
    `SELECT id, status FROM mdata.drivers WHERE id = $1 AND operating_company_id = $2::uuid LIMIT 1`,
    [body.driver_id, companyId]
  );
  const driver = driverRes.rows[0];
  if (!driver) return { ok: false, code: 404, error: "driver_not_found" };

  const res = await client.query(
    `
      INSERT INTO driver_finance.driver_reimbursements (
        operating_company_id, driver_id, load_id, reimbursement_type, amount_cents, reason, pay_mode,
        status, evidence_doc_id, created_by_user_id, from_bank_account_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10)
      RETURNING id
    `,
    [
      companyId,
      body.driver_id,
      body.load_id ?? null,
      body.reimbursement_type,
      body.amount_cents,
      body.reason.trim(),
      body.pay_mode ?? "settlement",
      body.evidence_doc_id ?? null,
      actorUserUuid,
      body.from_bank_account_id ?? null,
    ]
  );
  const reimbursementId = String(res.rows[0]?.id ?? "");
  if (!reimbursementId) return { ok: false, code: 500, error: "reimbursement_create_failed" };

  await appendCrudAudit(
    client,
    actorUserUuid,
    "driver_finance.reimbursement.created",
    {
      resource_type: "driver_finance.driver_reimbursements",
      resource_id: reimbursementId,
      operating_company_id: companyId,
      driver_id: body.driver_id,
      load_id: body.load_id ?? null,
      amount_cents: body.amount_cents,
      reimbursement_type: body.reimbursement_type,
      pay_mode: body.pay_mode ?? "settlement",
    },
    "info",
    AUDIT_TAG
  );

  // SETL-LINES-GL — "runs at line creation": if this driver already has an OPEN load-bookended
  // settlement covering this reimbursement's load, materialize it into a real settlement_lines row
  // (load_id + a resolved GL posting_account_id) immediately, rather than waiting for close. Best
  // effort: a materializer hiccup must never fail the reimbursement claim itself — the close-time
  // sweep (or a later manual retry) still picks up anything skipped here.
  if ((body.pay_mode ?? "settlement") === "settlement" && body.load_id) {
    try {
      const openSettlementRes = await client.query(
        `
          SELECT id::text FROM driver_finance.driver_settlements
           WHERE operating_company_id = $1::uuid AND driver_id = $2::uuid
             AND settlement_model = 'load_bookended' AND status = 'open'
           ORDER BY created_at DESC LIMIT 1
        `,
        [companyId, body.driver_id]
      );
      const openSettlementId = (openSettlementRes.rows[0] as { id?: string } | undefined)?.id;
      if (openSettlementId) {
        await materializeSettlementLines(client as unknown as Parameters<typeof materializeSettlementLines>[0], {
          settlementId: openSettlementId,
          operatingCompanyId: companyId,
          actorUserId: actorUserUuid,
        });
      }
    } catch (err) {
      logger.warn("settlement_lines_materialize_at_creation_failed", { err, reimbursementId });
    }
  }

  return { ok: true, reimbursementId };
}

export type PayReimbursementResult =
  | { ok: true; reimbursementId: string; posted: boolean; journalEntryId: string | null; postingDate: string }
  | { ok: false; code: number; error: string; message?: string };

/**
 * IMMEDIATE reimbursement pay-out — pays a pending reimbursement NOW, with NO settlement required. Flips
 * status pending -> paid and stamps paid_at + posting_date; then (when REIMBURSEMENT_GL_POSTING_ENABLED is
 * ON for the entity) posts Dr reimbursement_expense / Cr cash via the existing posting engine. OFF => the
 * claim is recorded paid, GL leg deferred until Jorge flips the flag. Back-dating (explicit posting_date)
 * is Owner/Administrator-only. Idempotent: re-paying an already-paid reimbursement is a no-op success.
 */
export async function payDriverReimbursementImmediately(
  actorUserUuid: string,
  actorRole: string,
  companyId: string,
  input: { reimbursement_id: string; posting_date?: string | null; credit_account_id?: string | null }
): Promise<PayReimbursementResult> {
  if (input.posting_date != null && !isOwnerOrAdmin(actorRole)) {
    return { ok: false, code: 403, error: "owner_admin_only" };
  }

  const phase1 = await withCurrentUser(actorUserUuid, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [companyId]);
    const cur = await client.query(
      `
        SELECT id::text, status::text, posting_date::text, journal_entry_id::text,
               amount_cents::text, from_bank_account_id::text
        FROM driver_finance.driver_reimbursements
        WHERE operating_company_id = $1::uuid AND id::text = $2
        LIMIT 1
        FOR UPDATE
      `,
      [companyId, input.reimbursement_id]
    );
    const row = cur.rows[0] as
      | { status?: string; posting_date?: string | null; journal_entry_id?: string | null; amount_cents?: string; from_bank_account_id?: string | null }
      | undefined;
    if (!row) return { ok: false as const, code: 404, error: "reimbursement_not_found" };
    const amountCents = Math.round(Number(row.amount_cents ?? "0"));
    const fromBankAccountId = row.from_bank_account_id ?? null;

    // Idempotent: already paid -> return current state (allow the GL retry below to fill a missing JE).
    if (String(row.status) === "paid") {
      return {
        ok: true as const,
        postingDate: String(row.posting_date ?? new Date().toISOString().slice(0, 10)),
        alreadyPaid: true,
        amountCents,
        fromBankAccountId,
      };
    }
    if (String(row.status) !== "pending") {
      return { ok: false as const, code: 409, error: "reimbursement_not_payable", message: `status=${row.status}` };
    }

    const upd = await client.query(
      `
        UPDATE driver_finance.driver_reimbursements
        SET status = 'paid',
            paid_at = now(),
            posting_date = COALESCE($3::date, CURRENT_DATE),
            updated_at = now()
        WHERE operating_company_id = $1::uuid AND id::text = $2
        RETURNING posting_date::text AS posting_date
      `,
      [companyId, input.reimbursement_id, input.posting_date ?? null]
    );
    const postingDate = String((upd.rows[0] as { posting_date?: string })?.posting_date ?? "");

    await appendCrudAudit(
      client,
      actorUserUuid,
      "driver_finance.reimbursement.paid",
      {
        resource_type: "driver_finance.driver_reimbursements",
        resource_id: input.reimbursement_id,
        operating_company_id: companyId,
        posting_date: postingDate,
        pay_mode: "immediate",
      },
      "info",
      AUDIT_TAG
    );

    return { ok: true as const, postingDate, alreadyPaid: false, amountCents, fromBankAccountId };
  });

  if (!phase1.ok) return phase1;

  // GL leg — per-entity OFF flag. When OFF, the pay-out is recorded but no JE posts (deferred).
  const postingEnabled = await withCurrentUser(actorUserUuid, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [companyId]);
    return isEnabled(client as never, REIMBURSEMENT_GL_POSTING_FLAG, {
      operating_company_id: companyId,
      user_uuid: actorUserUuid,
    });
  });

  if (!postingEnabled) {
    return { ok: true, reimbursementId: input.reimbursement_id, posted: false, journalEntryId: null, postingDate: phase1.postingDate };
  }

  // ACCT-F5687 — bank-cache decrement is ATOMIC with the JE post (postSourceTransactionInClientTx runs
  // on THIS client), same shape as ACCT-F358's driver-advance disburse: the bank-balance cache and the
  // GL cash account are separate stores, so recording -amount in both is cache coherence, not double
  // counting, and a posting failure now rolls back the decrement with it. Only decrement when the
  // reimbursement names its own bank AND the caller did not override the credit account at pay time
  // (an explicit credit_account_id is not guaranteed to be a banking.bank_accounts row).
  const posting = await withCurrentUser(actorUserUuid, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [companyId]);
    if (!input.credit_account_id && phase1.fromBankAccountId) {
      await updateBankBalance(client, companyId, phase1.fromBankAccountId, -Math.abs(phase1.amountCents));
    }
    return postSourceTransactionInClientTx(
      client,
      {
        operating_company_id: companyId,
        source_transaction_type: "driver_reimbursement",
        source_transaction_id: input.reimbursement_id,
        credit_account_id: input.credit_account_id ?? null,
      },
      { userId: actorUserUuid }
    );
  });

  try {
    await withCurrentUser(actorUserUuid, async (client) => {
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [companyId]);
      await client.query(
        `UPDATE driver_finance.driver_reimbursements SET journal_entry_id = $2::uuid, updated_at = now()
           WHERE operating_company_id = $1::uuid AND id::text = $3`,
        [companyId, posting.journal_entry_id, input.reimbursement_id]
      );
    });
  } catch (err) {
    logger.warn("reimbursement_je_backlink_failed", {
      err: err instanceof Error ? err.message : String(err),
      company_id: companyId,
      reimbursement_id: input.reimbursement_id,
      journal_entry_id: posting.journal_entry_id,
    });
  }

  return {
    ok: true,
    reimbursementId: input.reimbursement_id,
    posted: true,
    journalEntryId: posting.journal_entry_id ?? null,
    postingDate: phase1.postingDate,
  };
}
