// P1-BILL-GL — the gated auto-post entrypoint for a Bill's internal GL.
// createBill() historically inserted accounting.bills but never posted the DR expense / CR ap_control
// journal entry, so the internal double-entry ledger was blind to A/P (the only bill→GL path was a
// separate Owner/Admin, TRANSP-only manual endpoint the UI never called). This wires the SAME canonical
// writer the manual endpoint + draft preview use (postSourceTransaction 'bill' → CHAIN-03 poster), gated
// per-entity by BILL_GL_POSTING_ENABLED. NO new GL math — reuse only. Idempotent (one posting batch per
// bill via the poster's idempotency key). Enforced wired by verify-bill-create-posts-gl.mjs.
//
// Unlike bill_payment, creating a Bill moves no cash, so flag-OFF does NOT block bill creation — the bill
// is still recorded and the return carries an explicit unposted status (never a silent success).

import { postSourceTransaction, PostingEngineError } from "./posting-engine.service.js";
import { withCurrentUser } from "../auth/db.js";
import { isEnabled } from "../lib/feature-flags/service.js";
import { billOpenTourLoadId, TOUR_OPEN_HOLD_REASON } from "./tour-open-gate.service.js";

export const BILL_GL_POSTING_FLAG_KEY = "BILL_GL_POSTING_ENABLED";

type PostingResult = Awaited<ReturnType<typeof postSourceTransaction>>;

export type BillGlPostOutcome =
  | { posted: false; reason: "posting_disabled" }
  | { posted: false; reason: "tour_open"; load_id: string }
  | { posted: false; reason: "post_failed"; code: string; message: string }
  | { posted: true; result: PostingResult };

/**
 * Resolve BILL_GL_POSTING_ENABLED for an entity (user override first, then per-company override, then
 * default). Uses withCurrentUser + set_config (not withCompanyScope) — the caller (createBill) is already
 * authenticated and scoped, so this flag-read needs no membership re-assertion, and avoiding
 * withCompanyScope keeps the heavy company-membership/luciaPool dependency out of the createBill hot path.
 */
export async function isBillGlPostingEnabled(operatingCompanyId: string, userId: string): Promise<boolean> {
  return withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    return isEnabled(client, BILL_GL_POSTING_FLAG_KEY, {
      operating_company_id: operatingCompanyId,
      user_uuid: userId,
    });
  });
}

/**
 * Post a bill's balanced DR expense / CR ap_control JE if BILL_GL_POSTING_ENABLED is ON for the entity.
 * Flag OFF → `{posted:false, reason:"posting_disabled"}` (bill still stands, honest unposted status).
 * A PostingEngineError (e.g. unresolved account role) is surfaced as `post_failed` — NOT swallowed and
 * NOT allowed to roll back the already-committed bill; it is retriable via the manual /bills/:id/post-gl
 * endpoint (the poster is idempotent). Any other error propagates.
 */
export async function postBillGlIfEnabled(
  operatingCompanyId: string,
  billId: string,
  actor: { userId: string }
): Promise<BillGlPostOutcome> {
  // ACC-50 (LAW §2, ROUND 5) — "open tour posts nothing," checked BEFORE the posting flag so a
  // bill on a still-open tour never posts even when BILL_GL_POSTING_ENABLED is on. A bill spans
  // its lines' load_ids (accounting.bills itself has no load_id column); ANY line naming a
  // still-open-tour load holds the WHOLE bill — postSourceTransaction posts one document as one
  // balanced JE, never a partial post of just the closed-tour lines.
  const openTourLoadId = await withCurrentUser(actor.userId, (client) => {
    return billOpenTourLoadId(client, operatingCompanyId, billId);
  });
  if (openTourLoadId) {
    await withCurrentUser(actor.userId, async (client) => {
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
      await client.query(
        `UPDATE accounting.bills SET posting_hold_reason=$2, updated_at=now() WHERE id=$1::uuid AND operating_company_id=$3::uuid`,
        [billId, TOUR_OPEN_HOLD_REASON, operatingCompanyId]
      );
    });
    return { posted: false, reason: "tour_open", load_id: openTourLoadId };
  }

  const enabled = await isBillGlPostingEnabled(operatingCompanyId, actor.userId);
  if (!enabled) return { posted: false, reason: "posting_disabled" };

  try {
    const result = await postSourceTransaction(
      {
        operating_company_id: operatingCompanyId,
        source_transaction_type: "bill",
        source_transaction_id: billId,
      },
      { userId: actor.userId }
    );
    return { posted: true, result };
  } catch (err) {
    if (err instanceof PostingEngineError) {
      return { posted: false, reason: "post_failed", code: err.code, message: err.message };
    }
    throw err;
  }
}
