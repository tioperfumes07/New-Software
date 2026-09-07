// ACC-50 — "Open tour posts nothing" (LAW §2, ROUND 5). Half 2 of the ticket: when a tour closes
// (its settlement leaves the open statuses), every expense/bill that was held for one of the
// tour's loads posts in ONE batch, through the SAME engine the create/manual-post paths already
// use — postSourceTransaction (expenses) and postBillGlIfEnabled (bills). No new posting math is
// introduced here; this only decides WHEN the existing call happens.
//
// postSourceTransaction takes its OWN pool connection and its OWN transaction (documented on the
// function itself) — it must never be called from inside an already-open caller transaction, the
// same reason expenses.routes.ts's create-path calls it only AFTER its own creation transaction
// has committed and returned. This module therefore opens its own withCompanyScope reads rather
// than accepting the settlement-approve handler's client, and is invoked AFTER that handler's own
// transaction has committed.
import { postSourceTransaction, PostingEngineError } from "./posting-engine.service.js";
import { postBillGlIfEnabled } from "./bill-gl.service.js";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { withCompanyScope } from "./shared.js";
import { isLoadTourOpen } from "./tour-open-gate.service.js";
import { isEnabled } from "../lib/feature-flags/service.js";

// Same flag every other expense-GL-posting call site gates on (expenses.routes.ts's own
// EXPENSE_GL_POSTING_FLAG_KEY = "EXPENSE_GL_POSTING_ENABLED") — a local literal, not an import from
// that routes file, matching fuel-posting/maybe-post-from-fuel-transaction.service.ts's own
// FUEL_EXPENSE_GL_POSTING_FLAG_KEY precedent (a service file never imports a *.routes.ts module).
const EXPENSE_GL_POSTING_FLAG_KEY = "EXPENSE_GL_POSTING_ENABLED";

type DbClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

export type TourClosePostingResult = {
  expenses_posted: string[];
  expenses_still_held: string[];
  bills_posted: string[];
  bills_still_held: string[];
};

const EMPTY_RESULT: TourClosePostingResult = { expenses_posted: [], expenses_still_held: [], bills_posted: [], bills_still_held: [] };

/**
 * Called right after a tour's settlement leaves the open statuses (settlements-mvp.routes.ts's
 * approve handler, once its own transaction has committed). `loadIds` is every load
 * driver_finance.driver_bills/settlement_lines bookend to this settlement
 * (tour-open-gate.service.ts's loadIdsForSettlement). Re-checks isLoadTourOpen per load before
 * posting anything — a defensive re-verify, never trusted blindly, in case one of the load's
 * driver_bills is still linked to a DIFFERENT, still-open settlement.
 */
export async function postHeldDocumentsForClosedTour(
  operatingCompanyId: string,
  loadIds: string[],
  actor: { userId: string }
): Promise<TourClosePostingResult> {
  if (loadIds.length === 0) return EMPTY_RESULT;

  const closedLoadIds = await withCompanyScope(actor.userId, operatingCompanyId, async (client: DbClient) => {
    const open = new Set<string>();
    for (const loadId of loadIds) {
      if (await isLoadTourOpen(client, operatingCompanyId, loadId)) open.add(loadId);
    }
    return loadIds.filter((id) => !open.has(id));
  });
  if (closedLoadIds.length === 0) return EMPTY_RESULT;

  const heldExpenses = await withCompanyScope(actor.userId, operatingCompanyId, (client: DbClient) =>
    client.query<{ id: string; payment_account_uuid: string | null; vendor_uuid: string | null }>(
      `
        SELECT id::text, payment_account_uuid::text, vendor_uuid::text
        FROM accounting.expenses
        WHERE operating_company_id = $1::uuid
          AND posting_status = 'unposted'
          AND posting_hold_reason = 'tour_open'
          AND status <> 'void'
          AND load_id = ANY($2::uuid[])
      `,
      [operatingCompanyId, closedLoadIds]
    )
  );

  const result: TourClosePostingResult = { expenses_posted: [], expenses_still_held: [], bills_posted: [], bills_still_held: [] };

  // SETL-GATE-01 — every postSourceTransaction() call site must honor its per-entity posting flag
  // (verify-all-posting-paths-gated.mjs). This batch runs unconditionally once a tour closes, so the
  // flag is checked ONCE up front (it cannot change mid-loop) rather than per expense — matches
  // expenses.routes.ts's own explicit "Post to GL" gate: when OFF, every held expense simply stays
  // held (posting_hold_reason stays 'tour_open'), exactly the flag-OFF no-op every other expense-GL
  // posting call site already implements. Bills are unaffected — postBillGlIfEnabled below already
  // gates itself internally.
  const expensePostingEnabled =
    heldExpenses.rows.length === 0
      ? false
      : await withCompanyScope(actor.userId, operatingCompanyId, (client: DbClient) =>
          isEnabled(client as never, EXPENSE_GL_POSTING_FLAG_KEY, { operating_company_id: operatingCompanyId, user_uuid: actor.userId })
        );

  for (const expense of heldExpenses.rows) {
    if (!expensePostingEnabled) {
      // Flag OFF — no-op, same as every other expense-GL posting call site. Stays held.
      result.expenses_still_held.push(expense.id);
      continue;
    }
    if (!expense.payment_account_uuid && !expense.vendor_uuid) {
      // orphan guard, same as the manual /:id/post gate — never invent a payee to force a post.
      result.expenses_still_held.push(expense.id);
      continue;
    }
    try {
      const posting = await postSourceTransaction(
        { operating_company_id: operatingCompanyId, source_transaction_type: "expense", source_transaction_id: expense.id },
        actor
      );
      await withCompanyScope(actor.userId, operatingCompanyId, async (client: DbClient) => {
        await client.query(
          `UPDATE accounting.expenses
              SET posting_status='posted', posted_at=now(), journal_entry_id=$2::uuid, posting_hold_reason=NULL, updated_at=now()
            WHERE id=$1::uuid AND operating_company_id=$3::uuid`,
          [expense.id, posting.journal_entry_id, operatingCompanyId]
        );
        await appendCrudAudit(
          client,
          actor.userId,
          "expense.posted",
          { expense_id: expense.id, journal_entry_id: posting.journal_entry_id, source: "tour_close_batch" },
          "info"
        );
      });
      result.expenses_posted.push(expense.id);
    } catch (err) {
      if (!(err instanceof PostingEngineError)) throw err;
      result.expenses_still_held.push(expense.id);
    }
  }

  // BILLS — held rows with at least one line on one of these now-closed loads (and no OTHER line
  // still pointing at a genuinely open tour — postBillGlIfEnabled's own re-check enforces that).
  const heldBills = await withCompanyScope(actor.userId, operatingCompanyId, (client: DbClient) =>
    client.query<{ id: string }>(
      `
        SELECT DISTINCT b.id::text
        FROM accounting.bills b
        JOIN accounting.bill_lines bl ON bl.bill_id = b.id AND bl.voided_at IS NULL
        WHERE b.operating_company_id = $1::uuid
          AND b.posting_hold_reason = 'tour_open'
          AND b.voided_at IS NULL
          AND bl.load_id = ANY($2::uuid[])
      `,
      [operatingCompanyId, closedLoadIds]
    )
  );

  for (const bill of heldBills.rows) {
    const outcome = await postBillGlIfEnabled(operatingCompanyId, bill.id, actor);
    if (outcome.posted) {
      await withCompanyScope(actor.userId, operatingCompanyId, (client: DbClient) =>
        client.query(
          `UPDATE accounting.bills SET posting_hold_reason=NULL, updated_at=now() WHERE id=$1::uuid AND operating_company_id=$2::uuid`,
          [bill.id, operatingCompanyId]
        )
      );
      result.bills_posted.push(bill.id);
    } else {
      result.bills_still_held.push(bill.id);
    }
  }

  return result;
}
