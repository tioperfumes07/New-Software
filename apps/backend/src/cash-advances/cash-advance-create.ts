// C6-MONEY-JE-EXEMPT: this books the driver_liabilities + driver_advances rows (disbursement_status
// starts 'approved', never 'disbursed') — the real JE posts later, once, when the advance is
// actually disbursed, via one of two now-BOTH-correct paths: cash-advance-disburse.ts's
// disburseDriverAdvanceCore (postSourceTransactionInClientTx, source_transaction_type=
// "driver_advance") for a plain cash-out, or cash-advances.routes.ts's mark-disbursed (fixed in
// #19618 — postBillPaymentGlIfEnabled) for the linked_bill_id branch. Both were verified before
// this exemption; neither was assumed — GO-23 C6, 2026-09-02.
import { appendCrudAudit } from "../audit/crud-audit.js";
import { nextCashAdvanceDisplayId } from "./display-id.js";

type PgishClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type CashAdvanceRepaymentScheduleInput = {
  weekly_installment_amount: number;
  total_periods: number;
  cadence: "weekly" | "biweekly";
};

export type CashAdvancePurpose =
  | "fuel_deposit"
  | "border_fee"
  | "family_emergency"
  | "vendor_payment"
  | "lumper"
  | "other";

export type CashAdvanceRecoveryMode = "full" | "amortize";
export type CashAdvanceEconomicRouting = "driver_settlement" | "load_expense";

export type CreateDriverCashAdvanceCoreInput = {
  driver_id: string;
  amount: number;
  purpose: CashAdvancePurpose;
  // CLOSE-POST-A-2 (owner ruling 2026-09-06 ROUND 16.9) — "historical_backfill": a real,
  // already-happened wire the signed settlement document evidences, but with no matching
  // banking.bank_transactions row to point at today (the owner matches it in Banking later; see
  // driver_finance.driver_advances.matched_advance_id for that). Distinct from "wire" (a wire
  // WITH a real bank match) so the two never get confused in a report — same list-never-hides
  // spirit as every other typed status in this codebase.
  disbursement_method: "direct_bank_transfer" | "wire" | "comdata" | "comchek" | "in_person_check" | "historical_backfill";
  recipient_info: {
    recipient_type: "driver" | "vendor" | "third_party";
    recipient_name?: string | null;
    bank_reference?: string | null;
    notes?: string | null;
  };
  linked_bill_id?: string | null;
  repayment_schedule?: CashAdvanceRepaymentScheduleInput | null;
  // B3 (additive): the driver_liabilities.type to record. Defaults to "advance" so existing
  // callers are unchanged; the no-trip/no-bill fallback passes "loan". Free text, no DDL.
  liability_type?: "advance" | "loan";
  // B5 (additive): the driver_finance.driver_bills the advance is applied against (cascade
  // branches 1/2). NULL for the loan branch. Recorded on driver_advances for settlement netting.
  linked_driver_bill_id?: string | null;
  // Wizard-depth 2026-07-22 — ops + recovery + purpose→economics (parity with Book Load / requests).
  load_id?: string | null;
  unit_id?: string | null;
  trailer_id?: string | null;
  from_bank_account_id?: string | null;
  recovery_mode?: CashAdvanceRecoveryMode | null;
  economic_routing?: CashAdvanceEconomicRouting | null;
};

export async function resolveCompanyCashAdvanceThresholdDollars(client: PgishClient, companyId: string) {
  const fallback = Number(process.env.CASH_ADVANCE_THRESHOLD ?? 500);
  const hasColumnRes = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'org'
          AND table_name = 'companies'
          AND column_name = 'cash_advance_threshold'
      ) AS ok
    `
  );
  const hasColumn = Boolean(hasColumnRes.rows[0]?.ok);
  if (!hasColumn) return fallback;
  const thresholdRes = await client.query(
    `
      SELECT cash_advance_threshold
      FROM org.companies
      WHERE id = $1
      LIMIT 1
    `,
    [companyId]
  );
  return Number(thresholdRes.rows[0]?.cash_advance_threshold ?? fallback);
}

export type CreateDriverCashAdvanceCoreResult =
  | { ok: true; advanceId: string; displayId: string; liabilityId: string; data: Record<string, unknown> }
  | { ok: false; code: number; error: string; message?: string };

/** Purpose → books routing (master plan §2.2). Lumper is load expense, not personal amortize. */
// LOAD-COSTS-COMPLETE item (3) (owner ruling 2026-09-04, verbatim): "we never send fuel advance
// to a driver... the fuel advance from us to the driver is a company expense. he is a company
// driver, not an owner operator." driver_settlement routing books this liability-and-repayment
// machinery (driver_liabilities, driver_advances, recovery schedules, amortization) -- the
// owner-operator model. USMCA's fleet is entirely B1 company drivers (confirmed this session,
// SET-24) -- that model can never legitimately apply to a USMCA driver, for any purpose, even one
// an explicit caller override requests. Enforced HERE, at the service boundary, not in a React
// dropdown -- a rule only the UI enforces is not enforced (owner's own words).
const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";

export function resolveEconomicRouting(
  purpose: CashAdvancePurpose,
  explicit?: CashAdvanceEconomicRouting | null,
  operatingCompanyId?: string | null
): CashAdvanceEconomicRouting {
  if (operatingCompanyId === USMCA_COMPANY_ID) return "load_expense";
  if (explicit) return explicit;
  if (purpose === "lumper") return "load_expense";
  return "driver_settlement";
}

/** Build a schedule for full (single next-settlement) or amortize modes. */
export function resolveRepaymentSchedule(args: {
  amount: number;
  recoveryMode: CashAdvanceRecoveryMode;
  schedule?: CashAdvanceRepaymentScheduleInput | null;
}): CashAdvanceRepaymentScheduleInput {
  if (args.recoveryMode === "full") {
    return {
      weekly_installment_amount: Math.max(0.01, Math.round(args.amount * 100) / 100),
      total_periods: 1,
      cadence: "weekly",
    };
  }
  const schedule = args.schedule;
  if (!schedule) {
    const periods = 4;
    return {
      weekly_installment_amount: Math.max(0.01, Math.round((args.amount / periods) * 100) / 100),
      total_periods: periods,
      cadence: "weekly",
    };
  }
  return schedule;
}

async function columnExists(client: PgishClient, schema: string, table: string, column: string): Promise<boolean> {
  const res = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
          AND column_name = $3
      ) AS ok
    `,
    [schema, table, column]
  );
  return Boolean(res.rows[0]?.ok);
}

/**
 * Single code path for booking a driver cash advance (liability + deduction schedule + driver_advances + audit).
 * Call only inside a transaction with app.operating_company_id already set.
 */
export async function createDriverCashAdvanceCore(
  client: PgishClient,
  actorUserUuid: string,
  companyId: string,
  body: CreateDriverCashAdvanceCoreInput
): Promise<CreateDriverCashAdvanceCoreResult> {
  // B5 OVERFLOW SPLIT (owner direct instruction, 2026-09-02): "load pays the driver $500, he
  // needs $1,000 -> $500 clears the bill payment, $500 becomes a LOAN TO THE DRIVER, an ASSET to
  // us." When this advance is linked to a driver_finance.driver_bills row, the amount that
  // actually attaches to that bill is capped at the bill's REMAINING balance
  // (gross_amount_cents minus every prior non-voided advance already linked to it, so a partial
  // draw-down over several advances is honored, not just the first one). Anything requested
  // beyond that recurses through this exact function once more as a genuinely separate,
  // unlinked LOAN liability — never a bigger single row silently overstating what one load
  // actually owes the driver. The recursive call never carries linked_driver_bill_id, so this
  // cannot loop past one level.
  if (body.linked_driver_bill_id) {
    const billRes = await client.query(
      `
        SELECT gross_amount_cents
        FROM driver_finance.driver_bills
        WHERE id = $1
          AND operating_company_id = $2
        LIMIT 1
      `,
      [body.linked_driver_bill_id, companyId]
    );
    const bill = billRes.rows[0];
    if (!bill) return { ok: false, code: 404, error: "linked_driver_bill_not_found" };

    const priorRes = await client.query(
      `
        SELECT COALESCE(SUM(amount), 0) AS covered
        FROM driver_finance.driver_advances
        WHERE operating_company_id = $1
          AND linked_driver_bill_id = $2
          AND voided_at IS NULL
      `,
      [companyId, body.linked_driver_bill_id]
    );
    const grossCents = Math.round(Number(bill.gross_amount_cents ?? 0));
    const coveredCents = Math.round(Number(priorRes.rows[0]?.covered ?? 0) * 100);
    const remainingCents = Math.max(0, grossCents - coveredCents);
    const requestedCents = Math.round(body.amount * 100);

    if (requestedCents > remainingCents) {
      const overflowCents = requestedCents - remainingCents;
      const overflowNote = `Overflow beyond driver_bill ${body.linked_driver_bill_id} remaining balance $${(remainingCents / 100).toFixed(2)} — booked as a separate loan per owner's advance/bill-payment/loan-overflow rule.`;

      let primary: CreateDriverCashAdvanceCoreResult | null = null;
      if (remainingCents > 0) {
        primary = await createDriverCashAdvanceCore(client, actorUserUuid, companyId, {
          ...body,
          amount: remainingCents / 100,
        });
        if (!primary.ok) return primary;
      }

      const overflow = await createDriverCashAdvanceCore(client, actorUserUuid, companyId, {
        ...body,
        amount: overflowCents / 100,
        linked_driver_bill_id: null,
        liability_type: "loan",
        recipient_info: {
          ...body.recipient_info,
          notes: [body.recipient_info.notes ?? null, overflowNote].filter(Boolean).join("; "),
        },
      });
      if (!overflow.ok) return overflow;

      const primaryResult = primary ?? overflow;
      return {
        ...primaryResult,
        data: {
          ...primaryResult.data,
          overflow_loan: primary
            ? {
                advance_id: overflow.advanceId,
                liability_id: overflow.liabilityId,
                display_id: overflow.displayId,
                amount_cents: overflowCents,
              }
            : null,
        },
      };
    }
  }

  const economicRouting = resolveEconomicRouting(body.purpose, body.economic_routing, companyId);
  const isLoadExpense = economicRouting === "load_expense";

  if (isLoadExpense && !body.load_id) {
    return { ok: false, code: 400, error: "load_id_required_for_load_expense", message: "Lumper / load expense requires a load" };
  }
  if (body.purpose === "fuel_deposit" && (!body.load_id || !body.unit_id)) {
    return {
      ok: false,
      code: 400,
      error: "fuel_deposit_requires_load_and_unit",
      message: "Fuel deposit requires load and unit",
    };
  }
  // B8 (GO-23 wave 2) — the FE wizard's own zod schema already requires from_bank_account_id for
  // direct_bank_transfer (cash-advances.routes.ts createAdvanceBodySchema superRefine), but this
  // core function is also called directly by cash-advance-owner-approval.service.ts,
  // driver-hub-requests.service.ts, and bank-driver-advance.service.ts — none of which go through
  // that zod gate. A cash advance with no payment account AND no vendor recipient to stand in for
  // one is an orphan: nothing downstream (settlement deduction, GL cash leg, bank reconciliation)
  // can resolve which real-world account the money actually moved out of. Refuse it here, at the
  // one place every caller passes through, instead of leaving it "soft preferred" permissive.
  const isElectronicDisbursement = body.disbursement_method === "direct_bank_transfer" || body.disbursement_method === "wire";
  if (isElectronicDisbursement && !body.from_bank_account_id && body.recipient_info.recipient_type !== "vendor") {
    return {
      ok: false,
      code: 400,
      error: "cash_advance_orphan_no_payment_account",
      message: `${body.disbursement_method} disbursement requires from_bank_account_id (or a vendor recipient) — a cash advance with no resolvable payment account cannot reconcile against a real bank leg`,
    };
  }
  // Instrument reference (Comchek/Comdata/EFT/wire number) is the one field that lets the owner
  // match this advance to what actually cleared the bank — required, not optional, for every
  // disbursement method that produces a real external instrument. in_person_check is the one
  // legitimate exception (a physical handoff with no clearing-network reference to capture).
  // historical_backfill is the SECOND legitimate exception (CLOSE-POST-A-2, owner ruling
  // 2026-09-06 ROUND 16.9): a real wire genuinely happened, evidenced by the signed settlement
  // document, but the bank side was never identified — inventing a bank_reference here would be
  // exactly the fabricated-instrument-number the owner ruled against; the source-document citation
  // belongs in recipient_info.notes instead, which this branch does not require.
  if (body.disbursement_method !== "in_person_check" && body.disbursement_method !== "historical_backfill" && !body.recipient_info.bank_reference?.trim()) {
    return {
      ok: false,
      code: 400,
      error: "cash_advance_instrument_reference_required",
      message: `${body.disbursement_method} disbursement requires an instrument/reference number (recipient_info.bank_reference) — never optional for a real clearing-network disbursement`,
    };
  }

  const driverRes = await client.query(
    `
      SELECT id, status
      FROM mdata.drivers
      WHERE id = $1
        AND operating_company_id = $2::uuid
      LIMIT 1
    `,
    [body.driver_id, companyId]
  );
  const driver = driverRes.rows[0];
  if (!driver) return { ok: false, code: 404, error: "driver_not_found" };
  if (String(driver.status ?? "").toLowerCase() !== "active") {
    return { ok: false, code: 400, error: "driver_not_active" };
  }

  if (body.load_id) {
    const loadRes = await client.query(
      `
        SELECT id, assigned_unit_id
        FROM mdata.loads
        WHERE id = $1
          AND operating_company_id = $2::uuid
          AND soft_deleted_at IS NULL
        LIMIT 1
      `,
      [body.load_id, companyId]
    );
    if (!loadRes.rows[0]) return { ok: false, code: 404, error: "load_not_found" };
  }

  if (body.from_bank_account_id) {
    const bankRes = await client.query(
      `
        SELECT id
        FROM banking.bank_accounts
        WHERE id = $1
          AND operating_company_id = $2::uuid
        LIMIT 1
      `,
      [body.from_bank_account_id, companyId]
    );
    if (!bankRes.rows[0]) return { ok: false, code: 404, error: "from_bank_account_not_found" };
  }

  let linkedBill: Record<string, unknown> | null = null;
  if (body.linked_bill_id) {
    const billRes = await client.query(
      `
        SELECT id, total_amount, status, vendor_id, display_id
        FROM accounting.bills
        WHERE id = $1
          AND operating_company_id = $2::uuid
        LIMIT 1
      `,
      [body.linked_bill_id, companyId]
    );
    linkedBill = billRes.rows[0] ?? null;
    if (!linkedBill) return { ok: false, code: 404, error: "linked_bill_not_found" };
    if (String(linkedBill.status ?? "").toLowerCase() !== "unpaid") {
      return { ok: false, code: 400, error: "linked_bill_must_be_unpaid" };
    }
  }

  const displayId = await nextCashAdvanceDisplayId(client, companyId);
  const liabilityRes = await client.query(
    `
      INSERT INTO driver_finance.driver_liabilities (
        operating_company_id,
        driver_id,
        type,
        source_description,
        original_amount,
        current_balance,
        paid_to_date,
        requires_acknowledgment
      ) VALUES ($1, $2, $3, $4, $5, $6, 0, false)
      RETURNING id
    `,
    [
      companyId,
      body.driver_id,
      body.liability_type ?? "advance",
      isLoadExpense ? `Load expense advance ${displayId} (lumper — expense posting HOLD)` : `Cash advance ${displayId}`,
      body.amount,
      // Load expense is NOT driver-owed settlement debt by default — balance 0 until chargeback policy says otherwise.
      isLoadExpense ? 0 : body.amount,
    ]
  );
  const liabilityId = String(liabilityRes.rows[0]?.id ?? "");
  if (!liabilityId) return { ok: false, code: 500, error: "liability_create_failed" };

  const recoveryMode: CashAdvanceRecoveryMode | null = isLoadExpense
    ? null
    : body.recovery_mode === "amortize"
      ? "amortize"
      : "full";

  if (!isLoadExpense) {
    const schedule = resolveRepaymentSchedule({
      amount: body.amount,
      recoveryMode: recoveryMode ?? "full",
      schedule: body.repayment_schedule,
    });
    await client.query(
      `
        INSERT INTO driver_finance.deduction_schedule (
          operating_company_id,
          liability_id,
          driver_id,
          amount_per_period,
          total_periods,
          cadence,
          starts_on
        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE)
      `,
      [companyId, liabilityId, body.driver_id, schedule.weekly_installment_amount, schedule.total_periods, schedule.cadence]
    );
  } else {
    // Record a held schedule row for audit trail only — not active driver settlement recovery.
    await client.query(
      `
        INSERT INTO driver_finance.deduction_schedule (
          operating_company_id,
          liability_id,
          driver_id,
          amount_per_period,
          total_periods,
          cadence,
          starts_on,
          is_held,
          hold_reason
        ) VALUES ($1, $2, $3, $4, 1, 'weekly', CURRENT_DATE, true, $5)
      `,
      [
        companyId,
        liabilityId,
        body.driver_id,
        body.amount,
        "load_expense_not_driver_debt — lumper expense posting HOLD (CPA/Neon)",
      ]
    );
  }

  const insertAmount = linkedBill ? Number(linkedBill.total_amount ?? body.amount) : body.amount;

  const hasWizardCols = await columnExists(client, "driver_finance", "driver_advances", "economic_routing");
  const hasLoadId = await columnExists(client, "driver_finance", "driver_advances", "load_id");

  const recipientNotes = [
    body.recipient_info.notes ?? null,
    isLoadExpense ? "economic_routing=load_expense; expense JE HOLD until CPA/Neon" : null,
    !hasWizardCols && body.from_bank_account_id
      ? `from_bank_account_id=${body.from_bank_account_id} (column UNVERIFIED / pending migration)`
      : null,
  ]
    .filter(Boolean)
    .join("; ");

  let advanceId = "";
  if (hasWizardCols) {
    const advanceRes = await client.query(
      `
        INSERT INTO driver_finance.driver_advances (
          operating_company_id,
          display_id,
          driver_id,
          liability_id,
          amount,
          purpose,
          disbursement_method,
          disbursement_status,
          recipient_type,
          recipient_name,
          linked_bill_id,
          requires_owner_approval,
          created_by_user_id,
          linked_driver_bill_id,
          load_id,
          unit_id,
          trailer_id,
          from_bank_account_id,
          recovery_mode,
          economic_routing,
          outstanding_balance,
          memo
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, 'approved', $8, $9, $10, false, $11, $12,
          $13, $14, $15, $16, $17, $18, $19, $20
        )
        RETURNING id
      `,
      [
        companyId,
        displayId,
        body.driver_id,
        liabilityId,
        insertAmount,
        body.purpose,
        body.disbursement_method,
        body.recipient_info.recipient_type,
        body.recipient_info.recipient_name ?? null,
        body.linked_bill_id ?? null,
        actorUserUuid,
        body.linked_driver_bill_id ?? null,
        body.load_id ?? null,
        body.unit_id ?? null,
        body.trailer_id ?? null,
        body.from_bank_account_id ?? null,
        recoveryMode,
        economicRouting,
        isLoadExpense ? 0 : insertAmount,
        recipientNotes || null,
      ]
    );
    advanceId = String(advanceRes.rows[0]?.id ?? "");
  } else {
    // Pre-migration fallback: stamp load_id if present; bank id in recipient bank_reference / memo.
    const bankRef =
      body.recipient_info.bank_reference ??
      (body.from_bank_account_id ? `bank:${body.from_bank_account_id}` : null);
    const advanceRes = await client.query(
      `
        INSERT INTO driver_finance.driver_advances (
          operating_company_id,
          display_id,
          driver_id,
          liability_id,
          amount,
          purpose,
          disbursement_method,
          disbursement_status,
          recipient_type,
          recipient_name,
          linked_bill_id,
          requires_owner_approval,
          created_by_user_id,
          linked_driver_bill_id
          ${hasLoadId ? ", load_id" : ""}
          , memo
          , outstanding_balance
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, 'approved', $8, $9, $10, false, $11, $12
          ${hasLoadId ? ", $13" : ""}
          , $${hasLoadId ? 14 : 13}, $${hasLoadId ? 15 : 14}
        )
        RETURNING id
      `,
      hasLoadId
        ? [
            companyId,
            displayId,
            body.driver_id,
            liabilityId,
            insertAmount,
            body.purpose,
            body.disbursement_method,
            body.recipient_info.recipient_type,
            body.recipient_info.recipient_name ?? null,
            body.linked_bill_id ?? null,
            actorUserUuid,
            body.linked_driver_bill_id ?? null,
            body.load_id ?? null,
            [recipientNotes, bankRef].filter(Boolean).join("; ") || null,
            isLoadExpense ? 0 : insertAmount,
          ]
        : [
            companyId,
            displayId,
            body.driver_id,
            liabilityId,
            insertAmount,
            body.purpose,
            body.disbursement_method,
            body.recipient_info.recipient_type,
            body.recipient_info.recipient_name ?? null,
            body.linked_bill_id ?? null,
            actorUserUuid,
            body.linked_driver_bill_id ?? null,
            [recipientNotes, bankRef].filter(Boolean).join("; ") || null,
            isLoadExpense ? 0 : insertAmount,
          ]
    );
    advanceId = String(advanceRes.rows[0]?.id ?? "");
  }
  if (!advanceId) return { ok: false, code: 500, error: "advance_create_failed" };

  // LIABILITY column-wave: the liability row is created BEFORE the advance row exists (the advance
  // FKs to liabilityId, not the reverse), so origin/origin_id could not be set at INSERT time —
  // this is the one-time UPDATE that closes that gap, same origin/origin_id shape
  // fines.routes.ts / safety-v5.routes.ts already set at their own INSERT time. reference_doc_id
  // has no natural document here (a cash advance IS the document), so it stays NULL rather than
  // fabricating a value.
  await client.query(
    `UPDATE driver_finance.driver_liabilities SET origin = 'cash_advance', origin_id = $1 WHERE id = $2`,
    [advanceId, liabilityId]
  );

  await appendCrudAudit(
    client,
    actorUserUuid,
    "cash_advance.created",
    {
      resource_type: "driver_finance.driver_advances",
      resource_id: advanceId,
      operating_company_id: companyId,
      liability_id: liabilityId,
      linked_bill_id: body.linked_bill_id ?? null,
      display_id: displayId,
      load_id: body.load_id ?? null,
      unit_id: body.unit_id ?? null,
      trailer_id: body.trailer_id ?? null,
      from_bank_account_id: body.from_bank_account_id ?? null,
      recovery_mode: recoveryMode,
      economic_routing: economicRouting,
      purpose: body.purpose,
    },
    "info",
    "WIZARD-CASH-ADVANCE-CREATE-DEPTH"
  );

  const detailRes = await client
    .query(
      `
        SELECT *
        FROM views.cash_advances_with_context
        WHERE id = $1
        LIMIT 1
      `,
      [advanceId]
    )
    .catch(() => ({ rows: [] as Record<string, unknown>[] }));

  return {
    ok: true,
    advanceId,
    displayId,
    liabilityId,
    data: detailRes.rows[0] ?? {
      id: advanceId,
      display_id: displayId,
      economic_routing: economicRouting,
      recovery_mode: recoveryMode,
    },
  };
}

export type CreateEmployeeLoanCoreInput = Omit<CreateDriverCashAdvanceCoreInput, "linked_bill_id" | "liability_type">;

/**
 * B3 — canonical "create employee loan" entry point for the cash-advance cascade's
 * no-trip / no-bill fallback (B5 calls this when an advance can't be attached to a load
 * or open bill). Books a driver_liabilities row of type='loan' (a receivable recovered on
 * future settlements via the deduction_schedule), plus the driver_advances disbursement
 * record. Reuses createDriverCashAdvanceCore — the GL posting happens at disbursement
 * (disburseDriverAdvanceCore), not here. No linked bill by definition.
 */
export async function createEmployeeLoanCore(
  client: PgishClient,
  actorUserUuid: string,
  companyId: string,
  body: CreateEmployeeLoanCoreInput
): Promise<CreateDriverCashAdvanceCoreResult> {
  return createDriverCashAdvanceCore(client, actorUserUuid, companyId, {
    ...body,
    linked_bill_id: null,
    liability_type: "loan",
  });
}

/**
 * Shared reversal core — "undo this advance, no money actually moved." Extracted from
 * cash-advances.routes.ts's PATCH .../reverse (unchanged logic, same shape) so the load-cancellation
 * cascade (item 3, owner 2026-09-03: cancelling a load must also reverse the ADVANCES/LIABILITIES
 * it produced) can reuse the exact same primitive instead of re-inventing it inline.
 *
 * Caller's responsibility: gate on driver_finance.driver_liabilities.paid_to_date === 0 BEFORE
 * calling this (CASH-ADV-F9930's correct-grain guard) — this function does not re-check it, so a
 * caller that skips the check could reverse an already-recovered advance. Both current callers
 * (the route, and the cancellation cascade) check first.
 */
export async function reverseDriverAdvanceInClientTx(
  client: PgishClient,
  actorUserUuid: string,
  companyId: string,
  input: { advanceId: string; liabilityId: string | null; linkedBillPaymentId?: string | null; linkedBillId?: string | null; reason: string }
): Promise<void> {
  // ACCT-SETL-ADV-VOID-GAP: driver_advances/driver_liabilities have carried a full void register
  // (voided_at/void_reason/voided_by_user_id) since GO-22 (migration 202613490001), but this
  // pre-existing reversal path — the only real "undo an advance" action in the codebase, already
  // wired to a route (PATCH /api/v1/cash-advances/:id/reverse) and reused by the load-cancellation
  // cascade — predates GO-22 and only ever set the OLDER disbursement_status='reversed' /
  // current_balance=0 signals. Stamping the register here too (COALESCE-guarded, so a row already
  // voided by some other path is never clobbered) closes the gap with zero new logic: no new route,
  // no new UI, no change to WHEN/WHY this fires, just what it records when it does.
  await client.query(
    `
      UPDATE driver_finance.driver_advances
      SET disbursement_status = 'reversed',
          voided_at = COALESCE(voided_at, now()),
          void_reason = COALESCE(void_reason, $2),
          voided_by_user_id = COALESCE(voided_by_user_id, $3::uuid),
          updated_at = now()
      WHERE id = $1
    `,
    [input.advanceId, input.reason, actorUserUuid]
  );
  if (input.liabilityId) {
    await client.query(
      `
        UPDATE driver_finance.driver_liabilities
        SET current_balance = 0,
            paid_to_date = original_amount,
            status = 'reversed',
            voided_at = COALESCE(voided_at, now()),
            void_reason = COALESCE(void_reason, $2),
            voided_by_user_id = COALESCE(voided_by_user_id, $3::uuid)
        WHERE id = $1
      `,
      [input.liabilityId, input.reason, actorUserUuid]
    );
    await client.query(
      `
        UPDATE driver_finance.deduction_schedule
        SET is_held = true,
            hold_reason = $2,
            updated_at = now()
        WHERE liability_id = $1
      `,
      [input.liabilityId, input.reason]
    );
  }
  if (input.linkedBillPaymentId) {
    await client.query(
      `
        UPDATE accounting.bill_payments
        SET status = 'void',
            updated_at = now()
        WHERE id = $1
      `,
      [input.linkedBillPaymentId]
    );
    if (input.linkedBillId) {
      await client.query(
        `
          UPDATE accounting.bills
          SET status = 'unpaid',
              updated_at = now()
          WHERE id = $1
        `,
        [input.linkedBillId]
      );
    }
  }
  await appendCrudAudit(
    client as never,
    actorUserUuid,
    "cash_advance.reversed",
    {
      resource_type: "driver_finance.driver_advances",
      resource_id: String(input.advanceId),
      operating_company_id: companyId,
      liability_id: String(input.liabilityId ?? ""),
      reason: input.reason,
    },
    "warning",
    "BT-3-CASH-ADVANCE-REBUILD"
  );
}
