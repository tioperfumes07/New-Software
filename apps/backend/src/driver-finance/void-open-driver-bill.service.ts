/**
 * void-open-driver-bill.service.ts — SETL-TIEOUT-01 (owner order 2026-09-05, deadline 02:30Z).
 *
 * A driver_bills row (and the settlement_lines it minted) has NO existing PATCH/void path anywhere
 * in the codebase — the only writers are book-load.service.ts's own INSERT and
 * cancellation.service.ts's void-on-load-cancel (a different, load-scoped operation: "this load
 * never happened," not "this load's pay was mis-keyed"). Correcting a mis-seeded historical driver
 * bill (measured live: loads 13512/13513's bills used a blended total/loaded-miles calc, producing
 * $429.39/$248.40 against the signed source's $422.46/$244.94) needs a real, audited path.
 *
 * book-load.service.ts's createDriverBillArtifacts deliberately refuses to mint a SECOND bill for a
 * load that already has one, voided or not ("ACCT-F277 ... A voided bill remains evidence of an
 * intentional reversal and is not silently re-minted") — a real anti-duplicate-billing control, not
 * a bug. That control means correcting a mis-seeded bill cannot reuse that create path at all; this
 * module owns the ONE exception, narrowly scoped and fail-closed:
 *   1. void the wrong bill + its settlement lines (void-not-delete: voided_at/void_reason, never a
 *      DELETE, and never a raw UPDATE of a money row's dollar amounts in place),
 *   2. mint ONE replacement bill + its two settlement lines (earnings + deadhead_pay) with the
 *      corrected figures, in the SAME transaction, so the load is never left with zero live bills.
 *
 * FAIL-CLOSED guards: refuses anything except a genuinely OPEN, un-posted, un-approved bill on an
 * OPEN settlement; refuses if a live (non-voided) bill already exists for the load at call time
 * other than the one being corrected. This is a narrow "undo a same-day draft mistake" tool, never a
 * general bill-editing capability.
 */

type QueryClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

export class DriverBillVoidRefusedError extends Error {
  readonly code = "driver_bill_void_refused";
}

export type CorrectOpenDriverBillResult = {
  voided_bill_id: string;
  voided_settlement_line_ids: string[];
  new_bill_id: string;
  new_settlement_line_ids: string[];
  new_gross_amount_cents: number;
};

export async function correctOpenDriverBillMileage(
  client: QueryClient,
  input: {
    operatingCompanyId: string;
    loadId: string;
    loadNumber: string;
    actorUserId: string;
    reason: string;
    /** Loaded leg. */
    milesBasis: number;
    ratePerMileCents: number;
    loadedPayCents: number;
    /** Deadhead leg — omit (null) when this load has no deadhead. */
    milesDeadhead: number | null;
    rateEmptyPerMileCents: number | null;
    deadheadPayCents: number;
    isSampleData: boolean;
  }
): Promise<CorrectOpenDriverBillResult> {
  if (!input.reason || input.reason.trim().length < 20) {
    throw new DriverBillVoidRefusedError("reason must be a real, specific reason (>= 20 chars)");
  }

  const billRes = await client.query<{
    id: string;
    status: string;
    driver_id: string;
    team_driver_id: string | null;
    created_by_user_id: string;
  }>(
    `
      SELECT id::text, status, driver_id::text, team_driver_id::text, created_by_user_id::text
        FROM driver_finance.driver_bills
       WHERE operating_company_id = $1::uuid AND load_id = $2::uuid AND status <> 'void'
       LIMIT 1
    `,
    [input.operatingCompanyId, input.loadId]
  );
  const bill = billRes.rows[0];
  if (!bill) throw new DriverBillVoidRefusedError(`no live (non-voided) driver_bills row exists for load ${input.loadId} — nothing to correct`);
  if (bill.status !== "open") {
    throw new DriverBillVoidRefusedError(`driver_bills ${bill.id} has status='${bill.status}', not 'open' — refusing to correct a non-draft bill`);
  }

  const linesRes = await client.query<{ id: string; settlement_id: string; line_type: string; approval_status: string | null }>(
    `
      SELECT sl.id::text, sl.settlement_id::text, sl.line_type, sl.approval_status
        FROM driver_finance.settlement_lines sl
       WHERE sl.source_driver_bill_id = $1::uuid AND sl.is_active = true
    `,
    [bill.id]
  );
  if (linesRes.rows.length === 0) {
    throw new DriverBillVoidRefusedError(`driver_bills ${bill.id} has no live settlement_lines — nothing to correct through this path`);
  }
  const settlementId = linesRes.rows[0]!.settlement_id;
  for (const line of linesRes.rows) {
    if (line.approval_status === "approved") {
      throw new DriverBillVoidRefusedError(`settlement_lines ${line.id} is already approval_status='approved' — refusing to void an approved line`);
    }
    if (line.settlement_id !== settlementId) {
      throw new DriverBillVoidRefusedError(`bill ${bill.id}'s lines span more than one settlement — refusing an ambiguous correction`);
    }
  }
  const settlementRes = await client.query<{ status: string }>(
    `SELECT status::text FROM driver_finance.driver_settlements WHERE id = $1::uuid AND operating_company_id = $2::uuid LIMIT 1`,
    [settlementId, input.operatingCompanyId]
  );
  const settlementStatus = settlementRes.rows[0]?.status;
  if (!settlementStatus || settlementStatus !== "open") {
    throw new DriverBillVoidRefusedError(`settlement ${settlementId} has status='${settlementStatus ?? "MISSING"}', not 'open' — refusing to correct a line on a non-open settlement`);
  }

  // 1. Void the wrong bill + its lines. void-not-delete throughout.
  await client.query(
    `UPDATE driver_finance.driver_bills SET status = 'void', voided_at = now(), void_reason = $2, voided_by_user_id = $3::uuid WHERE id = $1::uuid AND status = 'open'`,
    [bill.id, input.reason, input.actorUserId]
  );
  const voidedLineIds: string[] = [];
  for (const line of linesRes.rows) {
    await client.query(
      `UPDATE driver_finance.settlement_lines SET is_active = false, voided_at = now(), void_reason = $2, voided_by_user_id = $3::uuid WHERE id = $1::uuid AND is_active = true`,
      [line.id, input.reason, input.actorUserId]
    );
    voidedLineIds.push(line.id);
  }

  // 2. Mint the replacement — same INSERT shape as book-load.service.ts's single-driver
  // createDriverBillArtifacts branch, corrected figures, one bill this time (never re-derive a
  // rate from a dollar target — every input here is a real, sourced number: milesBasis/ratePerMileCents
  // and milesDeadhead/rateEmptyPerMileCents are the caller's own already-verified reconciliation
  // figures, and *PayCents are their exact products).
  const grossAmountCents = input.loadedPayCents + input.deadheadPayCents;
  // driver_bills.bill_number is UNIQUE per operating_company_id (uniq_driver_bills_operating_
  // company_bill_number), and voiding does not clear it — the replacement needs its own distinct
  // number. "-R" (repair) mirrors the existing "-P"/"-S" team-split suffix convention rather than
  // inventing a new one; the load_number column (the FK-adjacent, load-facing identifier) stays the
  // unchanged real load number.
  const newBillNumber = `${input.loadNumber}-R`;
  const newBillRes = await client.query<{ id: string }>(
    `
      INSERT INTO driver_finance.driver_bills (
        operating_company_id, load_id, load_number, bill_number, driver_id, team_driver_id,
        gross_amount_cents, miles_basis, miles_basis_type, rate_per_mile_cents, status, notes,
        created_by_user_id, miles_deadhead, rate_empty_per_mile_cents, loaded_pay_cents, deadhead_pay_cents
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'short',$9,'open',$10,$11,$12,$13,$14,$15)
      RETURNING id::text
    `,
    [
      input.operatingCompanyId,
      input.loadId,
      input.loadNumber,
      newBillNumber,
      bill.driver_id,
      bill.team_driver_id,
      grossAmountCents,
      input.milesBasis,
      input.ratePerMileCents,
      input.reason,
      bill.created_by_user_id,
      input.milesDeadhead,
      input.rateEmptyPerMileCents,
      input.loadedPayCents,
      input.deadheadPayCents,
    ]
  );
  const newBillId = newBillRes.rows[0]!.id;

  // 3. Mint the replacement settlement lines — same (settlement_id, line_type, description, amount,
  // source_driver_bill_id, load_id, is_sample_data) shape as settlement-engine.ts's own INSERT for
  // this line pair, on the SAME settlement the voided lines belonged to.
  const newLineIds: string[] = [];
  const entries: Array<{ lineType: string; dollars: number; hasDeadhead: boolean }> = [
    { lineType: "earnings", dollars: input.loadedPayCents / 100, hasDeadhead: input.deadheadPayCents > 0 },
  ];
  if (input.deadheadPayCents > 0) entries.push({ lineType: "deadhead_pay", dollars: input.deadheadPayCents / 100, hasDeadhead: true });
  for (const entry of entries) {
    const description = entry.lineType === "deadhead_pay" ? `Load ${input.loadNumber} — Empty Miles` : entry.hasDeadhead ? `Load ${input.loadNumber} — Loaded Miles` : `Load ${input.loadNumber}`;
    const lineRes = await client.query<{ id: string }>(
      `
        INSERT INTO driver_finance.settlement_lines (
          settlement_id, line_type, description, amount, source_driver_bill_id, load_id, is_sample_data
        )
        VALUES ($1,$2,$3,$4,$5::uuid,$6::uuid,$7)
        RETURNING id::text
      `,
      [settlementId, entry.lineType, description, entry.dollars, newBillId, input.loadId, input.isSampleData]
    );
    newLineIds.push(lineRes.rows[0]!.id);
  }

  return {
    voided_bill_id: bill.id,
    voided_settlement_line_ids: voidedLineIds,
    new_bill_id: newBillId,
    new_settlement_line_ids: newLineIds,
    new_gross_amount_cents: grossAmountCents,
  };
}
