/**
 * settlement-lines-materialize.service.ts — SETL-LINES-GL (owner item, 2026-09-05, deadline 04:00Z).
 *
 * MEASURED (SETL-TIEOUT-01's own REMAINING): the OLDER, stricter settlement-pdf-5753.mjs requires
 * every settlement_lines row to carry load_id + a resolved posting_account_id + approval_status=
 * 'approved'. Two existing functions ALREADY materialize part of this at settlement CLOSE time —
 * computeSettlementReimbursements (settlement-contract-terms.service.ts) and
 * applyPendingDeductionsToSettlementWithNetFloor (settlement-deduction-cap.service.ts) — but NEITHER
 * sets load_id or posting_account_id, and both are gated behind close-time flags, never running at
 * line-creation time. This file is the missing piece: ONE materializer, callable idempotently at
 * BOTH creation time and close time, that fills exactly those two gaps for driver_reimbursements,
 * driver_settlement_deductions, and the extra-pay rows already stored in driver_reimbursements
 * (reimbursement_type='other' with a reason naming additional/layover/bonus pay — this table has no
 * distinct "extra pay" category of its own; see EXTRA_PAY_REASON_PATTERN below).
 *
 * IDEMPOTENT BY SOURCE ID: a driver_reimbursements row already carrying settlement_line_id, or a
 * driver_settlement_deductions row already carrying applied_to_settlement_id, is skipped — re-running
 * this on the same settlement is always a no-op for rows it already materialized. This function does
 * NOT supersede computeSettlementReimbursements / applyPendingDeductionsToSettlementWithNetFloor —
 * if those run later (settlement close, when their flags are on), they see the SAME idempotency
 * columns already set and skip the rows this function already applied, so the two paths can never
 * double-materialize the same source row.
 *
 * ACCOUNT RESOLUTION — reuses the EXISTING role machinery, no new GL math:
 *   reimbursement  -> role 'reimbursement_expense' (real, active COA role)
 *   extra_pay      -> role 'driver_pay_expense' (real, active COA role — extra pay is driver
 *                     compensation, the same bucket earnings/deadhead_pay already post to)
 *   deduction      -> bucketRecoveryRoleKey(deduction_type) (the SAME function
 *                     settlement-bill-payment-posting.service.ts / settlement-posting.service.ts /
 *                     settlement-payrun-close.service.ts already use to resolve a deduction's
 *                     recovery account), guarded by isCoaRole so an unmapped key never reaches the
 *                     resolver as a raw string.
 * An unresolved role (resolveRoleAccountOptional returns null, or isCoaRole rejects the derived key —
 * e.g. deduction_type='other' has no 'other_recovery' role bound) leaves posting_account_id NULL and
 * FORCES approval_status='pending' regardless of the source row's own status — LAW: never a guessed
 * account, and an approved line must always carry a real one (this is exactly what
 * verify-settlement-lines-have-accounts.mjs locks).
 *
 * approval_status FROM THE SOURCE (when a role DID resolve): driver_reimbursements.status
 * 'paid'/'settled' -> 'approved' (the claim is already processed); 'pending' -> 'pending'.
 * driver_settlement_deductions.status 'applied' -> 'approved'; 'pending'/'partial'/'deferred' ->
 * 'pending'. Neither table's status is overwritten here beyond what this function's own apply step
 * sets (driver_reimbursements -> 'settled', matching computeSettlementReimbursements' own convention;
 * driver_settlement_deductions keeps its existing status column, tracked instead via
 * applied_to_settlement_id, matching applyPendingDeductionsToSettlementWithNetFloor's own convention).
 *
 * "The tour's loads": the set of load_id values already present on this settlement's own earnings/
 * deadhead_pay settlement_lines rows (the load-bookended settlement's real load membership) — never
 * re-derived from a load-number range guess.
 */
import { appendCrudAudit } from "../audit/crud-audit.js";
import { resolveRoleAccountOptional, isCoaRole } from "../accounting/coa-roles/resolver.service.js";
import { bucketRecoveryRoleKey } from "../accounting/settlement-posting/settlement-bill-payment.math.js";
import { SETTLEMENT_DEDUCTION_SOURCE_TABLE } from "./deductions.service.js";
import { resolveDriverEscrowLiabilityAccount } from "./escrow-resolver.service.js";

type QueryClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

const REIMBURSEMENTS_SOURCE_TABLE = "driver_finance.driver_reimbursements";
// This table has no distinct "extra pay" category — additional/bonus/layover pay is entered as a
// driver_reimbursements row with reimbursement_type='other' (see scripts/seed-missing-usmca-loads.ts's
// own reimbursement_rows.concat(additional_pay_rows) loop). Narrowly scoped to the 'other' bucket only
// — a real toll/fuel/scale/parking/lumper reimbursement is NEVER reclassified as extra pay.
const EXTRA_PAY_REASON_PATTERN = /additional pay|layover|bonus/i;

export type DeductionPostingAccountResolution = {
  roleKey: string;
  postingAccountId: string | null;
  unresolvedReason?: string;
};

/**
 * SETL-DED-GL (owner ruling 2026-09-06 01:5xZ): the four typed deduction kinds each bind to a
 * SPECIFIC role/account, not the generic `${type}_recovery` bucket guess.
 *   company_vehicle_fuel -> REUSES the EXISTING, already-bound 'company_fuel_advance_expense'
 *     role (5000 Fuel & Diesel) — the SAME account a company fuel advance debits, so a recovery
 *     credit here is a contra to that same expense, matching the owner's "credits the account the
 *     fee/advance itself posts to" rule with NO new role/migration needed.
 *   escrow_contribution -> the DRIVER'S OWN escrow liability sub-account
 *     (resolveDriverEscrowLiabilityAccount) — explicitly NOT bucketRecoveryRoleKey's generic
 *     'escrow_contribution_recovery' guess.
 *   wire_fee / ach_fee -> a dedicated 'bank_fee_recovery' role (6300 Bank Service Charges & Wire
 *     Fees) is the semantically correct target — the existing 'factor_wire_fee' role already
 *     bound to 6300 is NOT reused here because it is a LIVE, actively-posted Faro-factoring role
 *     (poster.service.ts) and commingling an unrelated driver-fee recovery into it would corrupt
 *     factoring reconciliation. 'bank_fee_recovery' is a real CoaRole (resolver.service.ts) but,
 *     as of this writing, NOT yet admitted by chart_of_accounts_roles' DB-level CHECK constraint
 *     — CC-3 has no migration lane (standing law); a ready-to-apply draft migration + seed live
 *     in docs/audit/migration-drafts/BANK-FEE-RECOVERY-*.sql for a migration-lane seat. This
 *     branch already resolves it BY ROLE like every other typed kind (isCoaRole + resolveRole
 *     AccountOptional) — it correctly returns null/pending today (never a guessed account) and
 *     needs ZERO further code change the moment the migration lands and the role is bound.
 * Any OTHER/legacy deduction_type (including the grandfathered pre-existing 'other' rows, and the
 * SET-24 'reimbursement_reversal' type) keeps the original bucketRecoveryRoleKey fallback.
 *
 * EXTRACTED (ROUND 16.22): this was inline in materializeSettlementLines's deduction loop; pulled
 * out so backfillExistingSettlementLineAccounts below can resolve EXISTING deduction lines by the
 * SAME rules without a second, drifting copy of the branching logic.
 */
export async function resolveDeductionPostingAccount(
  client: QueryClient,
  operatingCompanyId: string,
  driverId: string,
  deductionType: string
): Promise<DeductionPostingAccountResolution> {
  let roleKey = bucketRecoveryRoleKey(deductionType);
  let postingAccountId: string | null = null;
  let unresolvedReason: string | undefined;
  if (deductionType === "wire_fee" || deductionType === "ach_fee") {
    roleKey = "bank_fee_recovery";
    postingAccountId = isCoaRole(roleKey) ? await resolveRoleAccountOptional(client, operatingCompanyId, roleKey) : null;
    if (!postingAccountId) unresolvedReason = `no COA role account bound for role 'bank_fee_recovery' (deduction_type '${deductionType}') — needs a migration to admit the role into chart_of_accounts_roles' CHECK constraint; see docs/audit/migration-drafts/BANK-FEE-RECOVERY-*.sql`;
  } else if (deductionType === "company_vehicle_fuel") {
    roleKey = "company_fuel_advance_expense";
    postingAccountId = isCoaRole(roleKey) ? await resolveRoleAccountOptional(client, operatingCompanyId, roleKey) : null;
    if (!postingAccountId) unresolvedReason = `no COA role account bound for role 'company_fuel_advance_expense' (deduction_type '${deductionType}')`;
  } else if (deductionType === "escrow_contribution") {
    roleKey = "escrow_contribution";
    try {
      const escrow = await resolveDriverEscrowLiabilityAccount(client, operatingCompanyId, driverId);
      postingAccountId = escrow.accountId;
    } catch (err) {
      postingAccountId = null;
      unresolvedReason = `driver escrow liability sub-account not resolved for deduction_type 'escrow_contribution': ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    postingAccountId = isCoaRole(roleKey) ? await resolveRoleAccountOptional(client, operatingCompanyId, roleKey) : null;
    if (!postingAccountId) unresolvedReason = `no COA role account bound for deduction_type '${deductionType}' (derived role '${roleKey}')`;
  }
  return { roleKey, postingAccountId, unresolvedReason };
}

export type MaterializedLine = {
  sourceTable: string;
  sourceId: string;
  settlementLineId: string;
  lineType: string;
  amountCents: number;
  postingAccountId: string | null;
  approvalStatus: "pending" | "approved";
  accountRoleAttempted: string;
  reason?: string;
};

export type MaterializeSettlementLinesResult = {
  settlementId: string;
  loadIds: string[];
  materialized: MaterializedLine[];
  skippedAlreadyMaterialized: number;
};

/**
 * Materialize every not-yet-materialized driver_reimbursements / driver_settlement_deductions row
 * for this settlement's own loads into a real settlement_lines row. Idempotent — safe to call
 * repeatedly (at line creation and again at close).
 */
export async function materializeSettlementLines(
  client: QueryClient,
  input: { settlementId: string; operatingCompanyId: string; actorUserId: string }
): Promise<MaterializeSettlementLinesResult> {
  const settlementRes = await client.query<{ id: string; driver_id: string; status: string; is_sample_data: boolean }>(
    `SELECT id::text, driver_id::text, status, is_sample_data FROM driver_finance.driver_settlements WHERE id = $1::uuid AND operating_company_id = $2::uuid LIMIT 1`,
    [input.settlementId, input.operatingCompanyId]
  );
  const settlement = settlementRes.rows[0];
  if (!settlement) return { settlementId: input.settlementId, loadIds: [], materialized: [], skippedAlreadyMaterialized: 0 };
  if (settlement.status !== "open") {
    // Only an OPEN settlement can gain new lines — matches every other settlement-lines writer's
    // own invariant (a locked/closed/paid/cancelled settlement's lines are frozen).
    return { settlementId: input.settlementId, loadIds: [], materialized: [], skippedAlreadyMaterialized: 0 };
  }

  const loadIdsRes = await client.query<{ load_id: string }>(
    `
      SELECT DISTINCT load_id::text
        FROM driver_finance.settlement_lines
       WHERE settlement_id = $1::uuid AND is_active = true AND load_id IS NOT NULL
    `,
    [input.settlementId]
  );
  const loadIds = loadIdsRes.rows.map((r) => r.load_id);
  if (loadIds.length === 0) return { settlementId: input.settlementId, loadIds: [], materialized: [], skippedAlreadyMaterialized: 0 };

  const materialized: MaterializedLine[] = [];
  let skipped = 0;

  // ---- driver_reimbursements (reimbursement + extra_pay) ----
  const reimbRes = await client.query<{
    id: string;
    amount_cents: string | number;
    reason: string | null;
    load_id: string | null;
    reimbursement_type: string | null;
    status: string;
  }>(
    `
      SELECT id::text, amount_cents, reason, load_id::text, reimbursement_type, status
        FROM driver_finance.driver_reimbursements
       WHERE operating_company_id = $1::uuid
         AND driver_id = $2::uuid
         AND load_id = ANY($3::uuid[])
         AND pay_mode = 'settlement'
         AND settlement_line_id IS NULL
         AND voided_at IS NULL
         AND status <> 'void'
       ORDER BY created_at ASC, id ASC
       FOR UPDATE
    `,
    [input.operatingCompanyId, settlement.driver_id, loadIds]
  );
  for (const r of reimbRes.rows) {
    const amountCents = Math.round(Number(r.amount_cents ?? 0));
    if (amountCents <= 0) continue;
    const isExtraPay = r.reimbursement_type === "other" && EXTRA_PAY_REASON_PATTERN.test(r.reason ?? "");
    const lineType = isExtraPay ? "extra_pay" : "reimbursement";
    const role = isExtraPay ? "driver_pay_expense" : "reimbursement_expense";
    const postingAccountId = await resolveRoleAccountOptional(client, input.operatingCompanyId, role);
    const sourceApproved = r.status === "paid" || r.status === "settled";
    const approvalStatus: "pending" | "approved" = postingAccountId && sourceApproved ? "approved" : "pending";

    const dollars = amountCents / 100;
    const description = `${lineType === "extra_pay" ? "Additional pay" : "Reimbursement"} — ${r.reimbursement_type ?? "expense"}${r.reason ? `: ${r.reason}` : ""}`.slice(0, 500);
    const lineRes = await client.query<{ id: string }>(
      `
        INSERT INTO driver_finance.settlement_lines (
          settlement_id, line_type, description, amount, load_id, source_table, source_reference_id,
          posting_account_id, approval_status, is_sample_data
        )
        VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7::uuid, $8::uuid, $9, $10)
        RETURNING id::text
      `,
      [input.settlementId, lineType, description, dollars, r.load_id, REIMBURSEMENTS_SOURCE_TABLE, r.id, postingAccountId, approvalStatus, settlement.is_sample_data]
    );
    const settlementLineId = lineRes.rows[0]!.id;

    await client.query(
      `
        UPDATE driver_finance.driver_reimbursements
           SET settlement_line_id = $2::uuid, applied_to_settlement_id = COALESCE(applied_to_settlement_id, $3::uuid),
               status = CASE WHEN status = 'pending' THEN 'settled' ELSE status END, updated_at = now()
         WHERE id = $1::uuid AND settlement_line_id IS NULL
      `,
      [r.id, settlementLineId, input.settlementId]
    );

    await appendCrudAudit(
      client as never,
      input.actorUserId,
      "driver_finance.settlement_line.materialized",
      { resource_type: "driver_finance.settlement_lines", resource_id: settlementLineId, source_table: REIMBURSEMENTS_SOURCE_TABLE, source_id: r.id, line_type: lineType, amount_cents: amountCents, posting_account_id: postingAccountId, approval_status: approvalStatus },
      "info",
      "SETL-LINES-GL"
    );

    materialized.push({
      sourceTable: REIMBURSEMENTS_SOURCE_TABLE,
      sourceId: r.id,
      settlementLineId,
      lineType,
      amountCents,
      postingAccountId,
      approvalStatus,
      accountRoleAttempted: role,
      reason: postingAccountId ? undefined : `no COA role account bound for role '${role}'`,
    });
  }

  // ---- driver_settlement_deductions ----
  const dedRes = await client.query<{
    id: string;
    amount_cents: string | number;
    reason: string | null;
    load_id: string | null;
    deduction_type: string;
    status: string;
  }>(
    `
      SELECT id::text, amount_cents, reason, load_id::text, deduction_type, status
        FROM driver_finance.driver_settlement_deductions
       WHERE operating_company_id = $1::uuid
         AND driver_id = $2::uuid
         AND load_id = ANY($3::uuid[])
         AND applied_to_settlement_id IS NULL
         AND voided_at IS NULL
       ORDER BY created_at ASC, id ASC
       FOR UPDATE
    `,
    [input.operatingCompanyId, settlement.driver_id, loadIds]
  );
  for (const d of dedRes.rows) {
    const amountCents = Math.round(Number(d.amount_cents ?? 0));
    if (amountCents <= 0) continue;
    const { roleKey, postingAccountId, unresolvedReason } = await resolveDeductionPostingAccount(
      client,
      input.operatingCompanyId,
      settlement.driver_id,
      d.deduction_type
    );
    const sourceApproved = d.status === "applied";
    const approvalStatus: "pending" | "approved" = postingAccountId && sourceApproved ? "approved" : "pending";

    const dollars = amountCents / 100;
    const description = String(d.reason ?? "Settlement deduction").slice(0, 500);
    const lineRes = await client.query<{ id: string }>(
      `
        INSERT INTO driver_finance.settlement_lines (
          settlement_id, line_type, description, amount, load_id, source_table, source_reference_id,
          posting_account_id, approval_status, is_sample_data
        )
        VALUES ($1::uuid, 'deduction', $2, $3, $4::uuid, $5, $6::uuid, $7::uuid, $8, $9)
        RETURNING id::text
      `,
      [input.settlementId, description, dollars, d.load_id, SETTLEMENT_DEDUCTION_SOURCE_TABLE, d.id, postingAccountId, approvalStatus, settlement.is_sample_data]
    );
    const settlementLineId = lineRes.rows[0]!.id;

    await client.query(
      `UPDATE driver_finance.driver_settlement_deductions SET applied_to_settlement_id = $2::uuid, remaining_balance_cents = 0, updated_at = now() WHERE id = $1::uuid AND applied_to_settlement_id IS NULL`,
      [d.id, input.settlementId]
    );

    await appendCrudAudit(
      client as never,
      input.actorUserId,
      "driver_finance.settlement_line.materialized",
      { resource_type: "driver_finance.settlement_lines", resource_id: settlementLineId, source_table: SETTLEMENT_DEDUCTION_SOURCE_TABLE, source_id: d.id, line_type: "deduction", amount_cents: amountCents, posting_account_id: postingAccountId, approval_status: approvalStatus },
      "info",
      "SETL-LINES-GL"
    );

    materialized.push({
      sourceTable: SETTLEMENT_DEDUCTION_SOURCE_TABLE,
      sourceId: d.id,
      settlementLineId,
      lineType: "deduction",
      amountCents,
      postingAccountId,
      approvalStatus,
      accountRoleAttempted: roleKey,
      reason: postingAccountId ? undefined : unresolvedReason,
    });
  }

  return { settlementId: input.settlementId, loadIds, materialized, skippedAlreadyMaterialized: skipped };
}

/**
 * Backfill helper: also resolves + stamps posting_account_id on this settlement's PRE-EXISTING
 * earnings/deadhead_pay lines that predate this file (they were never given a posting_account_id —
 * "never yet written by any live poster"). Idempotent: only touches rows where posting_account_id IS
 * NULL. Both line types are driver compensation, the same role earnings/deadhead already economically
 * belong to.
 */
export async function backfillDriverPayAccountOnExistingLines(
  client: QueryClient,
  input: { settlementId: string; operatingCompanyId: string }
): Promise<number> {
  const accountId = await resolveRoleAccountOptional(client, input.operatingCompanyId, "driver_pay_expense");
  if (!accountId) return 0;
  const res = await client.query<{ id: string }>(
    `
      UPDATE driver_finance.settlement_lines
         SET posting_account_id = $3::uuid
       WHERE settlement_id = $1::uuid
         AND operating_company_id = $2::uuid
         AND line_type IN ('earnings', 'deadhead_pay')
         AND posting_account_id IS NULL
         AND is_active = true
       RETURNING id::text
    `,
    [input.settlementId, input.operatingCompanyId, accountId]
  );
  return res.rows.length;
}

export type BackfillExistingLinesResult = {
  settlementId: string;
  driverPayUpdated: number;
  reimbursementUpdated: number;
  extraPayUpdated: number;
  escrowContributionUpdated: number;
  deductionUpdated: number;
  deductionSkippedNoSource: number;
  totalUpdated: number;
};

/**
 * ROUND 16.22 (owner ✔) — settlements 8/10 -> 10/10: materializeSettlementLines only resolves
 * posting_account_id for NEWLY-materialized source rows on an OPEN settlement (idempotent by
 * source id, gated on settlement.status === 'open'). It NEVER touches settlement_lines rows that
 * already existed before this file did — the vast majority of USMCA's historical settlements were
 * seeded/closed before this machinery existed and their reimbursement/deduction/escrow_contribution
 * lines still carry posting_account_id = NULL even though the settlement itself is long closed.
 * backfillDriverPayAccountOnExistingLines (above) already does this for earnings/deadhead_pay; this
 * is the SAME pattern extended to every other line type, callable regardless of settlement status
 * (an UPDATE-only backfill never creates a new line, never changes a dollar amount, and never
 * flips approval_status — a row that was never approved does not become approved just because its
 * account resolved years later; only posting_account_id changes).
 *
 * PER LINE TYPE:
 *   earnings / deadhead_pay -> delegates to backfillDriverPayAccountOnExistingLines (unchanged).
 *   extra_pay / reimbursement -> both route through the SAME single role (driver_pay_expense /
 *     reimbursement_expense respectively) for every row of that line_type — no per-row source
 *     lookup needed, because every real reimbursement/extra-pay row already resolves to the one
 *     company-wide account (verified live this session across every reimbursement_type seen).
 *   escrow_contribution -> the driver's OWN escrow liability sub-account, resolved via this
 *     settlement's own driver_id (joined from driver_finance.driver_settlements) — per-driver, so
 *     one UPDATE per settlement (all its escrow_contribution lines share the same settlement, hence
 *     the same driver).
 *   deduction -> the ONLY line type needing a per-row source lookup, because line_type is always
 *     the literal 'deduction' — the real deduction_type lives on the source
 *     driver_finance.driver_settlement_deductions row, joined via source_table/source_reference_id
 *     (rows with no source link at all — pre-materializer raw-seeded — are skipped, counted
 *     separately, never guessed). Reuses resolveDeductionPostingAccount, the SAME branching logic
 *     materializeSettlementLines's own deduction loop uses — one rule set, never two.
 *
 * NEVER silently drops a row: every row considered either gets an account or is counted in
 * deductionSkippedNoSource (the one case a per-row account genuinely cannot be resolved here).
 */
export async function backfillExistingSettlementLineAccounts(
  client: QueryClient,
  input: { settlementId: string; operatingCompanyId: string }
): Promise<BackfillExistingLinesResult> {
  const driverPayUpdated = await backfillDriverPayAccountOnExistingLines(client, input);

  const reimbAccountId = await resolveRoleAccountOptional(client, input.operatingCompanyId, "reimbursement_expense");
  let reimbursementUpdated = 0;
  if (reimbAccountId) {
    const res = await client.query<{ id: string }>(
      `
        UPDATE driver_finance.settlement_lines
           SET posting_account_id = $3::uuid
         WHERE settlement_id = $1::uuid AND operating_company_id = $2::uuid
           AND line_type = 'reimbursement' AND posting_account_id IS NULL AND is_active = true
         RETURNING id::text
      `,
      [input.settlementId, input.operatingCompanyId, reimbAccountId]
    );
    reimbursementUpdated = res.rows.length;
  }

  const extraPayAccountId = await resolveRoleAccountOptional(client, input.operatingCompanyId, "driver_pay_expense");
  let extraPayUpdated = 0;
  if (extraPayAccountId) {
    const res = await client.query<{ id: string }>(
      `
        UPDATE driver_finance.settlement_lines
           SET posting_account_id = $3::uuid
         WHERE settlement_id = $1::uuid AND operating_company_id = $2::uuid
           AND line_type = 'extra_pay' AND posting_account_id IS NULL AND is_active = true
         RETURNING id::text
      `,
      [input.settlementId, input.operatingCompanyId, extraPayAccountId]
    );
    extraPayUpdated = res.rows.length;
  }

  const settlementRes = await client.query<{ driver_id: string }>(
    `SELECT driver_id::text FROM driver_finance.driver_settlements WHERE id = $1::uuid AND operating_company_id = $2::uuid LIMIT 1`,
    [input.settlementId, input.operatingCompanyId]
  );
  const driverId = settlementRes.rows[0]?.driver_id ?? null;
  let escrowContributionUpdated = 0;
  if (driverId) {
    try {
      const escrow = await resolveDriverEscrowLiabilityAccount(client, input.operatingCompanyId, driverId);
      const res = await client.query<{ id: string }>(
        `
          UPDATE driver_finance.settlement_lines
             SET posting_account_id = $3::uuid
           WHERE settlement_id = $1::uuid AND operating_company_id = $2::uuid
             AND line_type = 'escrow_contribution' AND posting_account_id IS NULL AND is_active = true
           RETURNING id::text
        `,
        [input.settlementId, input.operatingCompanyId, escrow.accountId]
      );
      escrowContributionUpdated = res.rows.length;
    } catch {
      // No resolvable escrow sub-account for this driver — never guess; leave NULL, same as the
      // materializer's own live-flow behavior for an unresolved role.
    }
  }

  const dedRows = await client.query<{ id: string; deduction_type: string | null }>(
    `
      SELECT sl.id::text, dsd.deduction_type
        FROM driver_finance.settlement_lines sl
        LEFT JOIN driver_finance.driver_settlement_deductions dsd
          ON dsd.id = sl.source_reference_id AND sl.source_table = 'driver_finance.driver_settlement_deductions'
       WHERE sl.settlement_id = $1::uuid AND sl.operating_company_id = $2::uuid
         AND sl.line_type = 'deduction' AND sl.posting_account_id IS NULL AND sl.is_active = true
    `,
    [input.settlementId, input.operatingCompanyId]
  );
  let deductionUpdated = 0;
  let deductionSkippedNoSource = 0;
  for (const row of dedRows.rows) {
    if (!row.deduction_type || !driverId) {
      deductionSkippedNoSource += 1;
      continue;
    }
    const { postingAccountId } = await resolveDeductionPostingAccount(client, input.operatingCompanyId, driverId, row.deduction_type);
    if (!postingAccountId) continue; // unresolved role — leave NULL, never guess (counted as "still pending", not a drop)
    await client.query(
      `UPDATE driver_finance.settlement_lines SET posting_account_id = $2::uuid WHERE id = $1::uuid AND posting_account_id IS NULL`,
      [row.id, postingAccountId]
    );
    deductionUpdated += 1;
  }

  return {
    settlementId: input.settlementId,
    driverPayUpdated,
    reimbursementUpdated,
    extraPayUpdated,
    escrowContributionUpdated,
    deductionUpdated,
    deductionSkippedNoSource,
    totalUpdated: driverPayUpdated + reimbursementUpdated + extraPayUpdated + escrowContributionUpdated + deductionUpdated,
  };
}
