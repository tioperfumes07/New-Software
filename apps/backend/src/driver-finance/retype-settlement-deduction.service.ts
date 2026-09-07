// retype-settlement-deduction.service.ts — SETL-DED-GL (owner ruling 2026-09-06 01:5xZ) correction
// helper: driver_finance.driver_settlement_deductions.deduction_type is written once at creation and
// has no PATCH/edit route (never raw SQL for a financial write). Some historical rows were seeded with
// the generic 'other' type before this ruling and need retyping to one of the four real, GL-bound
// types — this is the narrow, guarded, service-function path for that correction, never a bare UPDATE.
//
// APPROACH (never forgives/reverses the underlying debt, matches settlement-deduction-void.service.ts's
// own "a void changes only WHEN/HOW, never WHETHER" design):
//   1. Void the OLD deduction row via the REAL voidSettlementDeduction() (record-only for a 'pending'
//      row with remaining_balance_cents already 0 — no money moves, nothing is forgiven).
//   2. Void the OLD settlement_lines row it had already materialized into (is_active=false,
//      voided_at/void_reason) — WORM void-not-delete, never a DELETE. materializeSettlementLines()
//      has no cascade-void of its own (voiding the source deduction only makes it invisible to a
//      FUTURE materialize pass; it does not touch a line already written), so this step is done here.
//   3. Create a REPLACEMENT deduction via the REAL createSettlementDeduction() with the corrected
//      deduction_type and the SAME driver/amount/load — a new row, not a mutated one, so the WORM
//      audit trail shows the correction as an event, not a silent edit.
//   4. Re-run materializeSettlementLines() so the replacement gets a FRESH settlement_lines row with
//      a role-resolved posting_account_id under the corrected type (never carried over stale).
//
// Fails closed: refuses unless the source deduction is 'pending' with remaining_balance_cents already
// 0 (i.e. already fully reflected in the settlement's own totals — a classification fix, not a
// collection-state change) and its settlement is still 'open' (matches materializeSettlementLines'
// own "only an OPEN settlement can gain new lines" invariant).

import { voidSettlementDeduction, DeductionVoidError } from "./settlement-deduction-void.service.js";
import { createSettlementDeduction, type SettlementDeductionSourceType, type Queryable as DeductionsQueryable } from "./deductions.service.js";
import { materializeSettlementLines, type MaterializeSettlementLinesResult } from "./settlement-lines-materialize.service.js";
import { appendCrudAudit } from "../audit/crud-audit.js";

export class RetypeDeductionError extends Error {
  constructor(
    readonly code: string,
    message?: string
  ) {
    super(message ?? code);
    this.name = "RetypeDeductionError";
  }
}

type QueryClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

export type RetypeSettlementDeductionInput = {
  operatingCompanyId: string;
  deductionId: string;
  newType: SettlementDeductionSourceType;
  reason: string;
  actorUserId: string;
};

export type RetypeSettlementDeductionResult = {
  oldDeductionId: string;
  newDeductionId: string;
  voidedLineId: string | null;
  materialize: MaterializeSettlementLinesResult;
};

export async function retypeSettlementDeduction(
  client: QueryClient,
  input: RetypeSettlementDeductionInput
): Promise<RetypeSettlementDeductionResult> {
  const src = await client.query<{
    id: string;
    driver_id: string;
    deduction_type: string;
    amount_cents: string;
    reason: string;
    status: string;
    remaining_balance_cents: string | null;
    applied_to_settlement_id: string | null;
    load_id: string | null;
  }>(
    `
      SELECT id::text, driver_id::text, deduction_type, amount_cents::text, reason, status,
             remaining_balance_cents::text, applied_to_settlement_id::text, load_id::text
        FROM driver_finance.driver_settlement_deductions
       WHERE id = $1::uuid AND operating_company_id = $2::uuid
       LIMIT 1
    `,
    [input.deductionId, input.operatingCompanyId]
  );
  const d = src.rows[0];
  if (!d) throw new RetypeDeductionError("deduction_not_found");
  if (d.status !== "pending") {
    throw new RetypeDeductionError("deduction_not_retypeable", `status '${d.status}' is not retypeable — only a 'pending' deduction not yet collected against can be retyped`);
  }
  const remainingCents = d.remaining_balance_cents != null ? Number(d.remaining_balance_cents) : Number(d.amount_cents);
  if (remainingCents !== 0) {
    throw new RetypeDeductionError("deduction_not_fully_reflected", "remaining_balance_cents must already be 0 (fully reflected in the settlement) for a classification-only retype");
  }
  if (!d.applied_to_settlement_id) {
    throw new RetypeDeductionError("deduction_not_applied", "retype is for a deduction already attached to a settlement; nothing to re-materialize otherwise");
  }

  const settlementRes = await client.query<{ id: string; status: string; operating_company_id: string }>(
    `SELECT id::text, status, operating_company_id::text FROM driver_finance.driver_settlements WHERE id = $1::uuid`,
    [d.applied_to_settlement_id]
  );
  const settlement = settlementRes.rows[0];
  if (!settlement || settlement.status !== "open") {
    throw new RetypeDeductionError("settlement_not_open", "the settlement this deduction is attached to must be 'open' to gain a re-materialized line");
  }

  // Step 1 — void the old deduction (record-only; 'pending' branch of voidSettlementDeduction).
  try {
    await voidSettlementDeduction(client as never, {
      operating_company_id: input.operatingCompanyId,
      deduction_id: d.id,
      reason: input.reason,
      actor_user_id: input.actorUserId,
    });
  } catch (err) {
    if (err instanceof DeductionVoidError) throw new RetypeDeductionError(`void_failed_${err.code}`, err.message);
    throw err;
  }

  // Step 2 — void the OLD settlement_lines row this deduction had already materialized into (void-
  // not-delete; the settlement_lines WORM trigger refuses a DELETE outright).
  const oldLine = await client.query<{ id: string }>(
    `
      UPDATE driver_finance.settlement_lines
         SET is_active = false, voided_at = now(), void_reason = $2, voided_by_user_id = $3::uuid
       WHERE settlement_id = $1::uuid
         AND source_table = 'driver_finance.driver_settlement_deductions'
         AND source_reference_id = $4::uuid
         AND is_active = true
      RETURNING id::text
    `,
    [d.applied_to_settlement_id, `SETL-DED-GL retype: ${input.reason}`, input.actorUserId, d.id]
  );
  const voidedLineId = oldLine.rows[0]?.id ?? null;

  // Step 3 — create the replacement deduction with the corrected type (real writer, never a bare
  // UPDATE of deduction_type — WORM audit sees this as a new row, matching the void-not-delete law).
  const replacement = await createSettlementDeduction(client as unknown as DeductionsQueryable, {
    driverId: d.driver_id,
    operatingCompanyId: input.operatingCompanyId,
    amountCents: Number(d.amount_cents),
    reason: d.reason,
    sourceType: input.newType,
    loadId: d.load_id,
    createdByUserId: input.actorUserId,
  });

  // Step 4 — re-materialize so the replacement gets a fresh, role-resolved posting_account_id.
  const materialize = await materializeSettlementLines(client as never, {
    settlementId: d.applied_to_settlement_id,
    operatingCompanyId: input.operatingCompanyId,
    actorUserId: input.actorUserId,
  });

  await appendCrudAudit(
    client as never,
    input.actorUserId,
    "driver_finance.settlement_deduction.retyped",
    {
      resource_type: "driver_finance.driver_settlement_deductions",
      resource_id: replacement.id,
      operating_company_id: input.operatingCompanyId,
      driver_id: d.driver_id,
      old_deduction_id: d.id,
      old_deduction_type: d.deduction_type,
      new_deduction_type: input.newType,
      old_settlement_line_id: voidedLineId,
      reason: input.reason,
    },
    "info",
    "SETL-DED-GL"
  );

  return { oldDeductionId: d.id, newDeductionId: replacement.id, voidedLineId, materialize };
}
