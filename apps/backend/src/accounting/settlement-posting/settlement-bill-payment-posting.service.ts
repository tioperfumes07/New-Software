// SETTLEMENT-BILL-PAYMENT — the canonical driver-settlement GL posting engine (blueprint §3, LOCKED).
// TIER-1 FINANCIAL, BUILD-AND-HOLD. Flag SETTLEMENT_GL_POSTING_ENABLED (default OFF) => NO-OP.
//
// Posts a finalized/locked driver settlement (TRANSP-first, never cross-post) as Bill + BillPayment,
// with the driver as a VENDOR (for A/P aging + 1099/W-8BEN). Reuses the existing posting spine only —
// NO new GL math:
//   • ONE Bill per LOAD (from each driver_finance.driver_bills row), numbered with the load #:
//       createBill + one accounting.bill_lines(driver_pay_expense) -> postSourceTransaction('bill')
//       = Dr "Cost of Labor–Mexico Drivers" (gross) / Cr A/P (driver-vendor, QBO-47).
//   • Deductions reduce A/P and credit the DRIVER'S OWN sub-accounts (pay-first-then-escrow):
//       advance recovery -> Cr <driver's Cash-Advance ASSET sub>; escrow withhold -> Cr <driver's
//       Driver-Escrow LIABILITY sub>; every other bucket -> Cr its shared {type}_recovery role.
//       Posted as ONE balanced createJournalEntry (Dr A/P total / Cr each target). Each per-load Bill's
//       A/P is closed in the subledger by a NON-CASH bill_payment (from_bank_account_id NULL,
//       settlement_deduction_noncash=true) whose GL is OWNED by this deduction JE (the shared
//       bill-payment poster skips it) — so subledger A/P and GL A/P both net correctly.
//   • Net BillPayment: payBill(net, from Wells Fargo DIP) -> postSourceTransaction('bill_payment')
//       = Dr A/P / Cr Wells Fargo — DIP.
//
// Deductions are sourced ONLY from driver_finance.driver_settlement_deductions (the canonical bucketed
// ledger; the 5% editable net floor + pay-first ordering are enforced by the applier at close), so the
// net is gross(bills) − Σ(deductions) BY CONSTRUCTION — no SETTLEMENT_TOTALS_INCONSISTENT reliance on
// the settlement_lines header. Consent = the hire contract (blueprint §2/§4) — NO separate signed-
// deduction-authorization gate.
//
// FULL CONNECTIVITY (blueprint §9): driver_finance.driver_settlement_gl_runs (settlement -> driver ->
// vendor -> deduction JE) + driver_settlement_gl_bills (settlement -> each driver_bill -> load ->
// accounting.bills -> bill JE -> cash + non-cash bill_payments) — forward + reverse, no orphans.
//
// PER-DRIVER ACCOUNT RESOLUTION: the driver sub-account resolver below reads the driver-keyed
// bridge-links — escrow via accounting.escrow_accounts (holder=driver, migration 0234), advance via
// driver_finance.driver_advance_accounts (PK operating_company_id+driver_id). Both are deterministic,
// driver-keyed lookups (NOT name resolution, which could shadow the wrong per-driver account and is a
// GL-correctness defect). The resolver FAILS LOUD when a driver's own sub-account bridge is not
// provisioned (never credits the shared recovery account for advance/escrow, never guesses).

import { withCurrentUser } from "../../auth/db.js";
import { DriverVendorMissingError, resolveDriverVendorLink } from "../driver-vendor-link.service.js";
import { isEnabled } from "../../lib/feature-flags/service.js";
import { companyBusinessDate } from "../../lib/company-business-date.js";
import { bankAccountHiddenFilterSql, isBankAccountHideEnabled } from "../../banking/bank-account-visibility.js";
import { appendCrudAudit } from "../../audit/crud-audit.js";
import { createBill, payBill, voidBillInClientTx, voidBillPaymentInClientTx } from "../bills.service.js";
import { createJournalEntry, reverseJournalEntryNoFlip } from "../journal-entries.service.js";
import { postSourceTransaction } from "../posting-engine.service.js";
import { restoreSettlementDeductionsInClientTx } from "./settlement-posting.service.js";
import { resolveRoleAccountOptional, isCoaRole } from "../coa-roles/resolver.service.js";
import {
  driverEscrowSubAccountName,
  planDriverEscrowSubAccount,
} from "../driver-subaccount-provision.service.js";
import { EscrowResolverError, resolveDriverEscrowLiabilityAccount } from "../../driver-finance/escrow-resolver.service.js";
import {
  SETTLEMENT_GL_POSTING_FLAG_KEY,
  SettlementBillPaymentError,
  allocateDeductionsAcrossBills,
  assertBalanced,
  bucketRecoveryRoleKey,
  buildSettlementRunKey,
  classifyDeductionTarget,
  deductionOrderRank,
  type DeductionTarget,
} from "./settlement-bill-payment.math.js";

type DbClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[]; rowCount?: number }>;
};

type Actor = { userId: string };

const POSTABLE_STATUSES = new Set(["locked", "final", "closed", "paid", "approved", "ready"]);

export type SettlementBillPaymentResult =
  | { result: "skipped_flag_off"; settlement_id: string; run_id: null }
  | { result: "already_posted"; settlement_id: string; run_id: string }
  | {
      result: "posted";
      settlement_id: string;
      run_id: string;
      driver_vendor_id: string;
      bill_count: number;
      gross_cents: number;
      deductions_cents: number;
      net_cents: number;
      deduction_journal_entry_id: string | null;
    };

type SettlementRow = {
  id: string;
  driver_id: string;
  display_id: string | null;
  status: string;
  locked_at: string | null;
  period_end: string;
};

type DriverBillRow = {
  id: string;
  load_id: string;
  load_number: string | null;
  gross_amount_cents: number;
};

type DeductionRow = {
  id: string;
  deduction_type: string;
  amount_cents: number;
  bucket_type: string | null;
  load_id: string | null;
  source_expense_id: string | null;
};

function scoped<T>(actor: Actor, operatingCompanyId: string, fn: (client: DbClient) => Promise<T>): Promise<T> {
  return withCurrentUser(actor.userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    return fn(client as DbClient);
  });
}

/**
 * Resolve the DIP bank account (banking.bank_accounts row) whose GL bridge (ledger_account_id) is the
 * account bound to the cash_dip role — so payBill(from that bank) + the bill-payment poster credit the
 * Wells Fargo — DIP cash account (never a hardcoded id). NULL when unmapped (caller fails loud).
 *
 * PRIMARY path: accounting.chart_of_accounts_roles via resolveRoleAccountOptional("cash_dip")
 * (legacy account_role_bindings is fallback inside the resolver only — never JOIN'd here).
 */
async function resolveDipBankAccountId(client: DbClient, operatingCompanyId: string): Promise<string | null> {
  const cashDipAccountId = await resolveRoleAccountOptional(client, operatingCompanyId, "cash_dip");
  if (!cashDipAccountId) return null;

  // BANK-ACCOUNT-HIDE: an account hidden for THIS entity is never eligible as the resolved DIP bank
  // (flag OFF by default — see docs/accounting/BANK-ACCOUNT-ENTITY-HIDE-DESIGN.md).
  const hideOn = await isBankAccountHideEnabled(client, operatingCompanyId);
  const res = await client.query<{ bank_account_id: string }>(
    `
      SELECT ba.id::text AS bank_account_id
      FROM banking.bank_accounts ba
      WHERE ba.operating_company_id = $1::uuid
        AND ba.ledger_account_id = $2::uuid
        ${bankAccountHiddenFilterSql(hideOn, "ba")}
      LIMIT 1
    `,
    [operatingCompanyId, cashDipAccountId]
  );
  return res.rows[0]?.bank_account_id ?? null;
}

/**
 * The driver's OWN per-driver sub-account (blueprint §4), resolved by the driver-keyed bridge-link:
 * escrow via accounting.escrow_accounts (holder=driver), advance via driver_finance.driver_advance_accounts
 * (PK operating_company_id+driver_id). NEVER returns the shared recovery/default account — advance and
 * escrow credits must land on the driver's OWN asset/liability sub-account or FAIL LOUD (returns null so
 * the caller throws). Escrow keeps a canonical-NAME fallback (two-level nesting) for its pre-bridge path;
 * advance is bridge-only (name resolution could shadow the wrong per-driver account).
 */
// Exported (was module-private) for ACCT-SETL-DEDUCTION-VOID-DESIGN — the deduction-void route's
// 'applied' branch reverses a single deduction's original credit and must resolve the SAME account
// this engine credited it to, never a second, independently-derived lookup for the same account.
export async function resolveDriverOwnAccount(
  client: DbClient,
  operatingCompanyId: string,
  driverId: string,
  driverName: string,
  kind: "advance" | "escrow",
  hireDate?: string | Date | null
): Promise<string | null> {
  // Foundation link (guarded so it is safe before that PR merges).
  if (kind === "escrow") {
    const reg = await client.query<{ ok: boolean }>(`SELECT to_regclass('accounting.escrow_accounts') IS NOT NULL AS ok`);
    if (reg.rows[0]?.ok) {
      // Reuse the SHARED escrow resolver (I3): the driver-keyed bridge → the per-driver escrow LIABILITY
      // sub-account, fail-loud asserting Liability + NOT the Faro factoring-reserve asset (QBO-1150040084).
      // UNBOUND falls through to the canonical-name fallback (pre-bridge charts); WRONG_TYPE / IS_FARO
      // rethrow so a mis-provisioned escrow bridge can never credit the wrong account.
      try {
        const resolved = await resolveDriverEscrowLiabilityAccount(client, operatingCompanyId, driverId);
        return resolved.accountId;
      } catch (e) {
        if (!(e instanceof EscrowResolverError) || e.code !== "DRIVER_ESCROW_ACCOUNT_UNBOUND") throw e;
      }
    }
    // Canonical provisioned per-driver escrow leaf: two-level nesting under the year-agnostic
    // "Driver Escrow" sub-parent, itself under top-level "Damage Claim Escrow" (STOP-DECISION #1).
    const subAccountName = driverEscrowSubAccountName(driverName, hireDate ?? null);
    const plan = await planDriverEscrowSubAccount(client, { subAccountName, operatingCompanyId });
    if (plan.action === "skip_exists") return plan.existingId;
    return null;
  }
  // ADVANCE — SYMMETRIC with escrow: resolve the driver's OWN Cash-Advance ASSET sub-account by the
  // driver-keyed bridge-link driver_finance.driver_advance_accounts (PK operating_company_id+driver_id),
  // NOT by name. Resolving by name went through resolveCanonicalParentAccount's OLDEST-match ORDER BY
  // created_at, so a residual/shadow "Driver Cash Advance" parent could shadow the driver's real advance
  // account — crediting the WRONG account (a GL-correctness defect; flaky in CI). The bridge is a
  // deterministic, driver-keyed lookup (mirrors accounting.escrow_accounts). Guarded with to_regclass so
  // it is safe before the migration runs. FAIL LOUD (return null -> caller throws
  // DRIVER_ADVANCE_ACCOUNT_MISSING) when the bridge row is absent — NEVER fall back to name resolution,
  // NEVER silently pick an account.
  const reg = await client.query<{ ok: boolean }>(
    `SELECT to_regclass('driver_finance.driver_advance_accounts') IS NOT NULL AS ok`
  );
  if (reg.rows[0]?.ok) {
    const found = await client.query<{ account_id: string }>(
      `
        SELECT daa.coa_account_id::text AS account_id
        FROM driver_finance.driver_advance_accounts daa
        JOIN catalogs.accounts a ON a.id = daa.coa_account_id
        WHERE daa.operating_company_id = $1::uuid
          AND daa.driver_id = $2::uuid
          AND daa.is_active = true
          AND a.parent_account_id IS NOT NULL      -- a per-driver SUB-account, never the shared parent
          AND a.deactivated_at IS NULL
          AND a.is_postable = true
          AND a.operating_company_id = $1::uuid
        LIMIT 1
      `,
      [operatingCompanyId, driverId]
    );
    if (found.rows[0]?.account_id) return found.rows[0].account_id;
  }
  return null;
}

async function loadSettlement(client: DbClient, operatingCompanyId: string, settlementId: string): Promise<SettlementRow> {
  const res = await client.query<SettlementRow>(
    `
      SELECT id::text, driver_id::text, display_id, status, locked_at::text, period_end::text
      FROM driver_finance.driver_settlements
      WHERE operating_company_id = $1::uuid AND id = $2::uuid
      LIMIT 1
      FOR UPDATE
    `,
    [operatingCompanyId, settlementId]
  );
  const row = res.rows[0];
  if (!row) throw new SettlementBillPaymentError("SETTLEMENT_NOT_FOUND", `Settlement ${settlementId} not found`);
  return row;
}

async function loadDriverBills(client: DbClient, operatingCompanyId: string, settlementId: string, driverId: string): Promise<DriverBillRow[]> {
  // Primary link: settlement_lines.source_driver_bill_id (the load-bookended close's bill->line link);
  // secondary: driver_bills.settled_in_settlement_id (stamped by this engine). Union both, dedup, order
  // by creation so the load# numbering + deduction allocation are deterministic.
  const res = await client.query<DriverBillRow>(
    `
      SELECT db.id::text, db.load_id::text, db.load_number, db.gross_amount_cents::int AS gross_amount_cents
      FROM driver_finance.driver_bills db
      WHERE db.operating_company_id = $1::uuid
        AND db.driver_id = $3::uuid
        AND db.status <> 'void'
        AND (
          db.settled_in_settlement_id = $2::uuid
          OR db.id IN (
            SELECT sl.source_driver_bill_id
            FROM driver_finance.settlement_lines sl
            WHERE sl.settlement_id = $2::uuid AND sl.source_driver_bill_id IS NOT NULL
              -- ACCT-F5655 — settlement_lines soft-deletes via is_active (ACCT-F156). Three sibling
              -- queries (settlement-payrun-close.service.ts, settlement-deduction-cap.service.ts,
              -- settlements-load-bookended.service.ts) already filter is_active=true on this same
              -- table; this poster -- the one that actually creates the driver's A/P bill and its GL --
              -- was the residual instance that missed it. No writer currently sets is_active=false on
              -- this table (only approve/reject status flips exist today), so this has never produced a
              -- wrong number -- applying the same already-decided exclusion before any deactivation
              -- feature ever lands.
              AND sl.is_active = true
          )
        )
      ORDER BY db.created_at ASC, db.id ASC
    `,
    [operatingCompanyId, settlementId, driverId]
  );
  return res.rows.map((r) => ({ ...r, gross_amount_cents: Math.max(0, Math.round(Number(r.gross_amount_cents ?? 0))) }));
}

async function loadDeductions(client: DbClient, operatingCompanyId: string, settlementId: string): Promise<DeductionRow[]> {
  const res = await client.query<DeductionRow>(
    `
      SELECT dsd.id::text, dsd.deduction_type, dsd.amount_cents::bigint AS amount_cents,
             ddb.bucket_type, dsd.load_id::text, dsd.source_expense_id::text
      FROM driver_finance.driver_settlement_deductions dsd
      LEFT JOIN driver_finance.driver_deduction_buckets ddb ON ddb.id = dsd.bucket_id
      WHERE dsd.operating_company_id = $1::uuid
        AND dsd.applied_to_settlement_id = $2::uuid
      ORDER BY dsd.created_at ASC, dsd.id ASC
    `,
    [operatingCompanyId, settlementId]
  );
  return res.rows
    .map((r) => ({ ...r, amount_cents: Math.max(0, Math.round(Number(r.amount_cents ?? 0))) }))
    .filter((r) => r.amount_cents > 0);
}

/**
 * Post a finalized/locked driver settlement to the GL as Bill + BillPayment. Flag-gated (OFF => no-op).
 * Idempotent (driver_settlement_gl_runs / _bills), re-entrant across the sequential createBill/payBill
 * commits. Reuses the accounting spine end-to-end, fails loud.
 */
export async function postSettlementBillPayment(
  input: { operatingCompanyId: string; settlementId: string },
  actor: Actor
): Promise<SettlementBillPaymentResult> {
  const opco = input.operatingCompanyId;
  const settlementId = input.settlementId;

  // ── FLAG GATE — OFF => ZERO writes, checked before any read/lock/insert. ──────────────────────────
  const flagOn = await scoped(actor, opco, (client) =>
    isEnabled(client as never, SETTLEMENT_GL_POSTING_FLAG_KEY, { operating_company_id: opco, user_uuid: actor.userId })
  );
  if (!flagOn) return { result: "skipped_flag_off", settlement_id: settlementId, run_id: null };

  // ── Resolve everything + claim the run row (idempotency anchor) in ONE scoped transaction. ────────
  const prep = await scoped(actor, opco, async (client) => {
    const settlement = await loadSettlement(client, opco, settlementId);
    if (settlement.locked_at == null && !POSTABLE_STATUSES.has(settlement.status)) {
      throw new SettlementBillPaymentError(
        "SETTLEMENT_NOT_POSTABLE",
        `Settlement ${settlement.display_id ?? settlement.id} is not finalized/locked (status=${settlement.status})`
      );
    }

    // ACCT-F5697 — THE OTHER settlement GL poster. `driver-finance/settlement-payrun-close.service.ts`'s
    // closeSettlementPayRun() independently claims driver_finance.payrun_gl_runs and posts a single
    // balanced JE (per-driver escrow LIABILITY + advance_recovery ASSET) for the SAME settlement, with
    // no awareness of driver_settlement_gl_runs and no awareness of this function. Both existed in prod
    // at once: S-2026-0002 was posted by BOTH — this poster on 2026-08-11 (Dr 6890 Cost of Labor
    // $297.60 / Cr 1000 Bank $297.60, no escrow withheld) and pay-run close on 2026-08-21 (Dr 6890
    // $297.60 / Cr Escrow $250.00 / Cr Bank $47.60) — Cost of Labor booked twice and the operating bank
    // credited $297.60 too much while payment_state stayed 'unpaid' the whole time. Mirrors the ACCT-F59
    // invoice↔revrec-latch interlock shape exactly: neither poster is retired here (that is a bigger
    // architecture call), each just refuses when the OTHER has demonstrably already posted.
    const otherPoster = await client.query<{ id: string }>(
      `
        SELECT id::text
          FROM driver_finance.payrun_gl_runs
         WHERE operating_company_id = $1::uuid
           AND settlement_id = $2::uuid
           AND status = 'posted'
           AND journal_entry_id IS NOT NULL
         LIMIT 1
      `,
      [opco, settlementId]
    );
    if ((otherPoster.rowCount ?? 0) > 0) {
      throw new SettlementBillPaymentError(
        "SETTLEMENT_ALREADY_POSTED_BY_OTHER_POSTER",
        `Settlement ${settlement.display_id ?? settlement.id} was already posted by pay-run close (payrun_gl_runs ${otherPoster.rows[0]!.id}) — refusing to double-post via bill-payment`,
        { payrun_gl_run_id: otherPoster.rows[0]!.id }
      );
    }

    // Existing run? (already_posted short-circuit)
    const existingRun = await client.query<{ id: string; status: string }>(
      `SELECT id::text, status FROM driver_finance.driver_settlement_gl_runs
        WHERE operating_company_id = $1::uuid AND settlement_id = $2::uuid LIMIT 1 FOR UPDATE`,
      [opco, settlementId]
    );
    const runRow = existingRun.rows[0] ?? null;
    if (runRow && runRow.status === "posted") {
      // ACCT-F348 — 'posted' ON THE RUN ROW IS NOT PROOF THE LEDGER RECEIVED ANYTHING.
      //
      // The run row is CLAIMED with status 'posted' (see the INSERT below — the CHECK constraint on
      // driver_settlement_gl_runs.status admits only 'posted'/'reversed', so there is no honest
      // in-progress value to claim it with). If the poster then throws part-way — which is exactly what
      // the duplicate-key crash this finding is about did — the settlement is left marked posted with
      // ZERO gl_bills and ZERO journal lines, and this short-circuit refuses to ever resume it. The
      // settlement becomes permanently unpostable while REPORTING that it posted.
      //
      // Measured on prod 2026-08-11: settlement S-2026-0002 (USMCA) had run c5caca25 status='posted',
      // 0 gl_bills, and $297.60 of driver pay sitting in an unposted A/P bill.
      //
      // The per-bill rows are the real completion signal, so ask them. Everything downstream is already
      // re-entrant (doneByBill + posting idempotency), so resuming an incomplete run cannot double-post.
      const doneBills = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM driver_finance.driver_settlement_gl_bills
          WHERE run_id = $1::uuid AND bill_journal_entry_id IS NOT NULL`,
        [runRow.id]
      );
      const postedBills = Number(doneBills.rows[0]?.n ?? "0");
      const expectedBills = (await loadDriverBills(client, opco, settlementId, settlement.driver_id)).length;
      // postedBills > 0 (not >= alone) so a run with nothing on the ledger can never look complete;
      // >= expectedBills keeps a legitimately finished run short-circuiting even if its driver bills
      // were voided afterwards, which drops expectedBills to 0.
      if (postedBills > 0 && postedBills >= expectedBills) {
        return { alreadyPosted: true as const, runId: runRow.id };
      }
    }

    // Driver vendor + name (+ hire_date, needed for the escrow leaf's stable name-with-hire-date).
    const driverRes = await client.query<{ qbo_vendor_id: string | null; driver_name: string; hire_date: string | null }>(
      `SELECT qbo_vendor_id, concat_ws(' ', first_name, last_name) AS driver_name, hire_date::text AS hire_date
         FROM mdata.drivers WHERE id = $1::uuid AND operating_company_id = $2::uuid LIMIT 1`,
      [settlement.driver_id, opco]
    );
    const driverName = String(driverRes.rows[0]?.driver_name ?? "").trim();
    const driverHireDate = driverRes.rows[0]?.hire_date ?? null;
    // CLS-DRIVER-VENDOR-UUID-FALLBACK — was `qbo_vendor_id ?? settlement.driver_id`, which made the
    // DRIVER_VENDOR_MISSING check below unreachable (a uuid is never falsy) and handed createBill a
    // DRIVER id in the vendor slot. On prod 0 of 181 drivers carry a qbo_vendor_id, so that fallback
    // was the only branch ever taken. The canonical link is mdata.vendors.driver_id; no vendor is a
    // hard stop, never a substitute id.
    let driverVendorId: string;
    try {
      driverVendorId = (await resolveDriverVendorLink(client, opco, settlement.driver_id)).vendorId;
    } catch (err) {
      if (err instanceof DriverVendorMissingError) {
        throw new SettlementBillPaymentError("DRIVER_VENDOR_MISSING", err.message);
      }
      throw err;
    }

    // Per-load bills + deductions.
    const bills = await loadDriverBills(client, opco, settlementId, settlement.driver_id);
    if (bills.length === 0) {
      throw new SettlementBillPaymentError("NO_LOAD_BILLS", `Settlement ${settlement.display_id ?? settlementId} has no per-load driver bills to post`);
    }
    const deductions = await loadDeductions(client, opco, settlementId);

    // Role accounts — missing => STOP, never guess.
    const driverPayAccount = await resolveRoleAccountOptional(client, opco, "driver_pay_expense");
    if (!driverPayAccount) {
      throw new SettlementBillPaymentError("DRIVER_PAY_ACCOUNT_MISSING", "No active 'driver_pay_expense' role designation (Cost of Labor–Mexico Drivers)");
    }
    const apAccount = await resolveRoleAccountOptional(client, opco, "ap_control");
    if (!apAccount) throw new SettlementBillPaymentError("AP_ACCOUNT_MISSING", "No A/P control account (ap_control) designated");

    const dipBankAccountId = await resolveDipBankAccountId(client, opco);
    if (!dipBankAccountId) {
      throw new SettlementBillPaymentError("DIP_BANK_MISSING", "No DIP bank account (cash_dip role -> banking.bank_accounts.ledger_account_id) resolved");
    }

    // Resolve each deduction's credit target account (pay-first-then-escrow order).
    const gross = bills.reduce((s, b) => s + b.gross_amount_cents, 0);
    const totalDeductions = deductions.reduce((s, d) => s + d.amount_cents, 0);
    if (totalDeductions > gross) {
      throw new SettlementBillPaymentError(
        "SETTLEMENT_TOTALS_INCONSISTENT",
        `Applied deductions (${totalDeductions}c) exceed gross of per-load bills (${gross}c) — the 5% net floor should prevent this`,
        { gross_cents: gross, deductions_cents: totalDeductions }
      );
    }

    type ResolvedDeduction = DeductionRow & { target: DeductionTarget; accountId: string };
    const resolvedDeductions: ResolvedDeduction[] = [];
    for (const d of deductions) {
      const target = classifyDeductionTarget(d.deduction_type, d.bucket_type);
      let accountId: string | null;
      if (target === "advance") {
        accountId = await resolveDriverOwnAccount(client, opco, settlement.driver_id, driverName, "advance");
        if (!accountId) {
          throw new SettlementBillPaymentError(
            "DRIVER_ADVANCE_ACCOUNT_MISSING",
            `Driver ${settlement.driver_id} has no provisioned Cash-Advance ASSET sub-account for advance recovery`,
            { deduction_id: d.id, deduction_type: d.deduction_type }
          );
        }
      } else if (target === "escrow") {
        accountId = await resolveDriverOwnAccount(client, opco, settlement.driver_id, driverName, "escrow", driverHireDate);
        if (!accountId) {
          throw new SettlementBillPaymentError(
            "DRIVER_ESCROW_ACCOUNT_MISSING",
            `Driver ${settlement.driver_id} has no provisioned Driver-Escrow LIABILITY sub-account for escrow withholding`,
            { deduction_id: d.id, deduction_type: d.deduction_type }
          );
        }
      } else {
        const roleKey = bucketRecoveryRoleKey(d.deduction_type);
        // Dynamic role key ({type}_recovery): resolve via the primary designation table (legacy binding
        // as fallback tier) when it is a known CoaRole, else fail CLOSED (never silently posts).
        accountId = isCoaRole(roleKey) ? await resolveRoleAccountOptional(client, opco, roleKey) : null;
        if (!accountId) {
          throw new SettlementBillPaymentError(
            "DEDUCTION_RECOVERY_ACCOUNT_MISSING",
            `No active '${roleKey}' role designation for deduction bucket '${d.deduction_type}'`,
            { deduction_id: d.id, role_key: roleKey }
          );
        }
      }
      resolvedDeductions.push({ ...d, target, accountId });
    }
    resolvedDeductions.sort((a, b) => deductionOrderRank(a.target) - deductionOrderRank(b.target));

    // Claim / upsert the run row.
    const runKey = buildSettlementRunKey(opco, settlementId);
    let runId = runRow?.id ?? "";
    if (!runId) {
      const ins = await client.query<{ id: string }>(
        `
          INSERT INTO driver_finance.driver_settlement_gl_runs
            (operating_company_id, settlement_id, driver_id, driver_vendor_id, run_key,
             gross_cents, deductions_cents, net_cents, status, posted_by_user_id)
          VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, 'posted', $9::uuid)
          ON CONFLICT (operating_company_id, settlement_id) DO NOTHING
          RETURNING id::text
        `,
        [opco, settlementId, settlement.driver_id, driverVendorId, runKey, gross, totalDeductions, gross - totalDeductions, actor.userId]
      );
      runId = ins.rows[0]?.id ?? "";
      if (!runId) {
        const again = await client.query<{ id: string }>(
          `SELECT id::text FROM driver_finance.driver_settlement_gl_runs WHERE operating_company_id=$1::uuid AND settlement_id=$2::uuid LIMIT 1`,
          [opco, settlementId]
        );
        runId = again.rows[0]?.id ?? "";
      }
    }
    if (!runId) throw new Error("settlement_gl_run_claim_failed");

    // Existing per-bill rows (re-entrancy).
    const existingBills = await client.query<{
      driver_bill_id: string;
      accounting_bill_id: string;
      bill_journal_entry_id: string | null;
      cash_bill_payment_id: string | null;
      deduction_bill_payment_id: string | null;
    }>(
      `SELECT driver_bill_id::text, accounting_bill_id::text, bill_journal_entry_id::text,
              cash_bill_payment_id::text, deduction_bill_payment_id::text
         FROM driver_finance.driver_settlement_gl_bills WHERE run_id = $1::uuid`,
      [runId]
    );
    const doneByBill = new Map(existingBills.rows.map((r) => [r.driver_bill_id, r]));

    const runDedJe = await client.query<{ deduction_journal_entry_id: string | null }>(
      `SELECT deduction_journal_entry_id::text FROM driver_finance.driver_settlement_gl_runs WHERE id = $1::uuid`,
      [runId]
    );

    return {
      alreadyPosted: false as const,
      settlement,
      driverName,
      driverVendorId,
      driverPayAccount,
      apAccount,
      dipBankAccountId,
      bills,
      resolvedDeductions,
      gross,
      totalDeductions,
      runId,
      doneByBill,
      deductionJournalEntryId: runDedJe.rows[0]?.deduction_journal_entry_id ?? null,
    };
  });

  if (prep.alreadyPosted) return { result: "already_posted", settlement_id: settlementId, run_id: prep.runId };

  const {
    settlement,
    driverVendorId,
    driverPayAccount,
    apAccount,
    dipBankAccountId,
    bills,
    resolvedDeductions,
    gross,
    totalDeductions,
    runId,
    doneByBill,
  } = prep;
  let deductionJournalEntryId = prep.deductionJournalEntryId;

  const billDate = settlement.period_end;
  const label = `Settlement ${settlement.display_id ?? settlement.id}`;

  // SETL-HEADER-05 (owner work order 2026-08-30) — the ONLY writer of driver_finance
  // .driver_settlements.accounting_bill_id / accounting_bill_payment_id used to be
  // payroll/driver-settlement.service.deprecated.ts, a RETIRE-lane writer against a DIFFERENT table
  // (payroll.driver_settlements). This LIVE poster wrote those ids into
  // driver_finance.driver_settlement_gl_bills (per-bill child rows) but never back to the settlement
  // header itself, which is what let transaction-health.service.ts's linkage signal
  // (s.accounting_bill_id IS NOT NULL) score every settlement as unlinked even though the money
  // posted correctly. A settlement can span multiple driver_bills (multiple accounting.bills); the
  // header back-link is a linkage SIGNAL, not a reconciliation source (that stays
  // driver_finance.driver_settlement_gl_bills, one row per bill) — so it captures the FIRST bill
  // processed this run, matching the deprecated writer's own single-id header shape.
  let headerAccountingBillId: string | null = null;
  let headerCashBillPaymentId: string | null = null;

  // Allocate the total deduction across the per-load bills (oldest first) so each Bill closes.
  const allocation = allocateDeductionsAcrossBills(bills.map((b) => b.gross_amount_cents), totalDeductions);

  // ── Per-load Bills + non-cash deduction closure + net cash BillPayment (each self-scoping). ───────
  for (let i = 0; i < bills.length; i += 1) {
    const b = bills[i]!;
    const alloc = allocation[i]!;
    const already = doneByBill.get(b.id);

    let accountingBillId = already?.accounting_bill_id ?? "";
    let billJeId = already?.bill_journal_entry_id ?? null;
    let cashBpId = already?.cash_bill_payment_id ?? null;
    let deductionBpId = already?.deduction_bill_payment_id ?? null;

    // (a) create the Bill (numbered by load#) + one driver-pay expense line + post its A/P leg.
    if (!accountingBillId) {
      // ACCT-F348 — the driver-pay line is passed INTO createBill, not added after it.
      //
      // The GL poster reads accounting.bill_lines (not coa_account_id), and createBill AUTO-POSTS while
      // BILL_GL_POSTING_ENABLED is ON for this entity. Creating the header first and adding the line
      // afterwards therefore guaranteed that auto-post ran against a line-less bill, failed
      // BILL_LINE_ACCOUNT_UNRESOLVED, and committed a `failed` posting batch under the bill's
      // deterministic idempotency key — which the explicit post below then collided with. Building the
      // bill complete in one call means the first post is the one that succeeds, so this path no longer
      // depends on failure-then-retry at all.
      const lineDescription = `Load ${b.load_number ?? b.load_id} — Cost of Labor–Mexico Drivers`;
      const bill = await createBill(
        {
          operatingCompanyId: opco,
          vendorId: driverVendorId,
          // GO-19 slice 03 (owner reversal of the prior AP-BILL-NUMBER-IS-THE-LOAD-NUMBER rationale
          // below) — driver bill number EQUALS the load number, no 'B-' prefix, matching
          // driver-bill-number.ts's driverBillNumberFromLoadNumber contract everywhere else a driver
          // bill number is minted. Per-load uniqueness is unchanged (uq_bills_tms_native_vendor_bill_number
          // scopes on operating_company_id + mdata_vendor_id + bill_number, and load_number is already
          // unique per load) so dedupe/idempotency behavior this same call relies on is unaffected.
          billNumber: String(b.load_number ?? b.load_id),
          billDate,
          amountCents: b.gross_amount_cents,
          memo: `${label} — driver pay, load ${b.load_number ?? b.load_id}`,
          coaAccountId: driverPayAccount,
          lines: [
            {
              amountCents: b.gross_amount_cents,
              description: lineDescription,
              accountId: driverPayAccount,
              // The bill→load link lives on the LINE (accounting.bills has no load_id). The hand-rolled
              // INSERT this replaces never wrote it, so driver-pay bills reached the ledger with no
              // machine-readable path back to the load whose pay they are.
              loadId: b.load_id,
            },
          ],
        },
        actor.userId
      );
      accountingBillId = bill.id;
      // Backstop, not the primary path: if a future createBill change stops writing bill_lines, the
      // poster must still find its line rather than fail closed on a settlement mid-flight.
      await scoped(actor, opco, (client) =>
        client.query(
          `INSERT INTO accounting.bill_lines (bill_id, line_sequence, amount, description, account_id, load_id)
           VALUES ($1::uuid, 1, $2, $3, $4::uuid, $5::uuid)
           ON CONFLICT (bill_id, line_sequence) DO NOTHING`,
          [accountingBillId, b.gross_amount_cents / 100, lineDescription, driverPayAccount, b.load_id]
        )
      );
      // ACCT-F348 — PERSIST THE LINK THE INSTANT THE BILL EXISTS, not at the end of the leg.
      //
      // The per-load link row was written only in step (d), AFTER the bill JE and both payments. A crash
      // anywhere in (a)–(c) therefore left an accounting bill that NOTHING pointed at: doneByBill came
      // back empty on the next run, step (a) called createBill again with the same load-numbered
      // bill_number, and the LV-AP-DUP duplicate-vendor-invoice control refused it — so the settlement
      // could not go forward (no link) and could not start over (duplicate number). That is what
      // stranded USMCA bill L-20260810-0003 ($297.60) after the duplicate-key crash.
      //
      // Step (d)'s upsert COALESCEs every downstream id, so writing the skeleton here and filling it in
      // there composes exactly as before — this only makes the bill discoverable one step earlier.
      await scoped(actor, opco, (client) =>
        client.query(
          `
            INSERT INTO driver_finance.driver_settlement_gl_bills
              (operating_company_id, run_id, settlement_id, driver_bill_id, load_id, load_number,
               accounting_bill_id, gross_cents, deduction_cents, cash_cents)
            VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7::uuid,$8,$9,$10)
            ON CONFLICT (operating_company_id, driver_bill_id) DO UPDATE SET
              accounting_bill_id = EXCLUDED.accounting_bill_id
          `,
          [opco, runId, settlementId, b.id, b.load_id, b.load_number, accountingBillId, b.gross_amount_cents, alloc.deductionCents, alloc.cashCents]
        )
      );
    }
    if (!billJeId) {
      const billPost = await postSourceTransaction(
        { operating_company_id: opco, source_transaction_type: "bill", source_transaction_id: accountingBillId, posting_purpose: "initial_post" },
        { userId: actor.userId }
      );
      billJeId = billPost.journal_entry_id;
    }

    // (b) NON-CASH deduction bill_payment closes the deduction share (GL owned by the deduction JE).
    if (alloc.deductionCents > 0 && !deductionBpId) {
      const dedPayment = await payBill(
        {
          operatingCompanyId: opco,
          billId: accountingBillId,
          paymentDate: billDate,
          amountCents: alloc.deductionCents,
          paymentMethod: "other",
          memo: `${label} — deduction recovery (non-cash), load ${b.load_number ?? b.load_id}`,
        },
        actor.userId
      );
      deductionBpId = dedPayment.id;
      await scoped(actor, opco, (client) =>
        client.query(
          `UPDATE accounting.bill_payments SET settlement_deduction_noncash = true, updated_at = now()
            WHERE id = $1::uuid AND operating_company_id = $2::uuid`,
          [deductionBpId, opco]
        )
      );
    }

    // (c) net cash BillPayment from Wells Fargo — DIP + post Dr A/P / Cr DIP.
    let cashJeId: string | null = null;
    if (alloc.cashCents > 0 && !cashBpId) {
      const cashPayment = await payBill(
        {
          operatingCompanyId: opco,
          billId: accountingBillId,
          paymentDate: billDate,
          amountCents: alloc.cashCents,
          paymentMethod: "ach",
          fromBankAccountId: dipBankAccountId,
          memo: `${label} — net driver pay, load ${b.load_number ?? b.load_id}`,
        },
        actor.userId
      );
      cashBpId = cashPayment.id;
      const cashPost = await postSourceTransaction(
        { operating_company_id: opco, source_transaction_type: "bill_payment", source_transaction_id: cashBpId, posting_purpose: "initial_post" },
        { userId: actor.userId }
      );
      cashJeId = cashPost.journal_entry_id;
    }

    // (d) connectivity: stamp the driver_bill + persist the per-load link row (upsert for re-entrancy).
    await scoped(actor, opco, async (client) => {
      await client.query(
        `UPDATE driver_finance.driver_bills
            SET settled_in_settlement_id = $2::uuid, status = 'paid', updated_at = now()
          WHERE id = $1::uuid AND operating_company_id = $3::uuid AND status <> 'void'`,
        [b.id, settlementId, opco]
      );
      await client.query(
        `
          INSERT INTO driver_finance.driver_settlement_gl_bills
            (operating_company_id, run_id, settlement_id, driver_bill_id, load_id, load_number,
             accounting_bill_id, bill_journal_entry_id, cash_bill_payment_id, cash_journal_entry_id,
             deduction_bill_payment_id, gross_cents, deduction_cents, cash_cents)
          VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7::uuid,$8::uuid,$9::uuid,$10::uuid,$11::uuid,$12,$13,$14)
          ON CONFLICT (operating_company_id, driver_bill_id) DO UPDATE SET
            accounting_bill_id = EXCLUDED.accounting_bill_id,
            bill_journal_entry_id = COALESCE(EXCLUDED.bill_journal_entry_id, driver_settlement_gl_bills.bill_journal_entry_id),
            cash_bill_payment_id = COALESCE(EXCLUDED.cash_bill_payment_id, driver_settlement_gl_bills.cash_bill_payment_id),
            cash_journal_entry_id = COALESCE(EXCLUDED.cash_journal_entry_id, driver_settlement_gl_bills.cash_journal_entry_id),
            deduction_bill_payment_id = COALESCE(EXCLUDED.deduction_bill_payment_id, driver_settlement_gl_bills.deduction_bill_payment_id),
            -- ACCT-F348: the amounts belong to the run that actually posted. The skeleton row written in
            -- step (a) carries this leg's allocation as computed at creation time; refreshing them here
            -- means the link row can never keep a figure the posted entries disagree with.
            gross_cents = EXCLUDED.gross_cents,
            deduction_cents = EXCLUDED.deduction_cents,
            cash_cents = EXCLUDED.cash_cents
        `,
        [opco, runId, settlementId, b.id, b.load_id, b.load_number, accountingBillId, billJeId, cashBpId, cashJeId, deductionBpId, b.gross_amount_cents, alloc.deductionCents, alloc.cashCents]
      );
    });

    // SETL-HEADER-05 — capture the first bill's ids for the header back-link written below.
    if (headerAccountingBillId === null && accountingBillId) {
      headerAccountingBillId = accountingBillId;
      headerCashBillPaymentId = cashBpId;
    }
  }

  // ── Deduction JE (ONE balanced entry): Dr A/P (total) / Cr each driver-own-or-recovery target. ───
  if (totalDeductions > 0 && !deductionJournalEntryId) {
    const postings = [
      { account_id: apAccount, debit_or_credit: "debit" as const, amount_cents: totalDeductions, description: `${label} — A/P reduced by deductions` },
      ...resolvedDeductions.map((d) => ({
        account_id: d.accountId,
        debit_or_credit: "credit" as const,
        amount_cents: d.amount_cents,
        description:
          d.target === "advance"
            ? `${label} — advance recovery -> driver cash-advance`
            : d.target === "escrow"
              ? `${label} — escrow withhold -> driver escrow`
              : `${label} — ${d.deduction_type} recovery`,
      })),
    ];
    assertBalanced(postings);
    const je = await createJournalEntry(
      { operating_company_id: opco, entry_date: billDate, memo: `${label} — settlement deductions (Dr A/P / Cr driver accounts)`, source: "auto", postings },
      { userId: actor.userId, role: "system" }
    );
    deductionJournalEntryId = je.id;
    await scoped(actor, opco, (client) =>
      client.query(
        `UPDATE driver_finance.driver_settlement_gl_runs SET deduction_journal_entry_id = $2::uuid, updated_at = now() WHERE id = $1::uuid`,
        [runId, deductionJournalEntryId]
      )
    );
  }

  // ── Finalize the run + immutable audit. ──────────────────────────────────────────────────────────
  await scoped(actor, opco, async (client) => {
    await client.query(
      `UPDATE driver_finance.driver_settlement_gl_runs
          SET gross_cents = $2, deductions_cents = $3, net_cents = $4, status = 'posted', updated_at = now()
        WHERE id = $1::uuid`,
      [runId, gross, totalDeductions, gross - totalDeductions]
    );
    // SETL-POST-01 (lead ROUND 13, 2026-09-06): migration 202607520000 added driver_settlements.
    // posted_at/posted_by_user_id anticipating this exact stamp ("posted_at <- post UPDATE (now())")
    // but the write never landed in either live poster (this one included) — a settlement genuinely
    // posted through THIS path still read posted_at IS NULL forever. Unconditional (not gated on
    // headerAccountingBillId like the back-link below) — this run just finalized as 'posted' above,
    // regardless of whether a header bill link exists. COALESCE guards a re-entrant call.
    await client.query(
      `UPDATE driver_finance.driver_settlements
          SET posted_at = COALESCE(posted_at, now()), posted_by_user_id = COALESCE(posted_by_user_id, $2::uuid)
        WHERE id = $1::uuid`,
      [settlementId, actor.userId]
    );
    // SETL-HEADER-05 — the missing header back-link, in the SAME transaction as the run finalize so
    // it can never disagree with what actually posted. COALESCE keeps a re-entrant/idempotent call
    // (already-posted bills, headerAccountingBillId null) from clobbering a previously-written link.
    if (headerAccountingBillId) {
      await client.query(
        `UPDATE driver_finance.driver_settlements
            SET accounting_bill_id = COALESCE(accounting_bill_id, $2::uuid),
                accounting_bill_payment_id = COALESCE(accounting_bill_payment_id, $3::uuid),
                updated_at = now()
          WHERE id = $1::uuid`,
        [settlementId, headerAccountingBillId, headerCashBillPaymentId]
      );
    }
    await appendCrudAudit(
      client as never,
      actor.userId,
      "accounting.settlement.bill_payment_posted",
      {
        resource_type: "driver_finance.driver_settlements",
        resource_id: settlementId,
        operating_company_id: opco,
        run_id: runId,
        driver_id: settlement.driver_id,
        driver_vendor_id: driverVendorId,
        bill_count: bills.length,
        gross_cents: gross,
        deductions_cents: totalDeductions,
        net_cents: gross - totalDeductions,
        deduction_journal_entry_id: deductionJournalEntryId,
      },
      "info",
      "SETTLEMENT-BILL-PAYMENT"
    );
  });

  return {
    result: "posted",
    settlement_id: settlementId,
    run_id: runId,
    driver_vendor_id: driverVendorId,
    bill_count: bills.length,
    gross_cents: gross,
    deductions_cents: totalDeductions,
    net_cents: gross - totalDeductions,
    deduction_journal_entry_id: deductionJournalEntryId,
  };
}

export type SettlementBillPaymentReversalResult = {
  result: "reversed" | "nothing_to_reverse";
  settlement_id: string;
  run_id: string | null;
};

/**
 * Reverse a posted settlement (void-not-delete): post equal-and-opposite reversing entries for each
 * per-load bill + cash bill_payment (reversePostedSourceTransaction), post a reversing deduction JE
 * (Dr each target / Cr A/P), and flip the run to 'reversed'. The non-cash deduction bill_payments carry
 * no GL of their own, so only the deduction JE is reversed for them.
 */
export async function reverseSettlementBillPayment(
  input: { operatingCompanyId: string; settlementId: string; reason: string },
  actor: Actor
): Promise<SettlementBillPaymentReversalResult> {
  const opco = input.operatingCompanyId;
  const currentBusinessDate = companyBusinessDate();
  return scoped(actor, opco, (client) =>
    reverseSettlementBillPaymentInClientTx(client, input, actor, currentBusinessDate)
  );
}

export async function reverseSettlementBillPaymentInClientTx(
  client: DbClient,
  input: { operatingCompanyId: string; settlementId: string; reason: string },
  actor: Actor,
  currentBusinessDate: string
): Promise<SettlementBillPaymentReversalResult> {
    const opco = input.operatingCompanyId;
    const settlementId = input.settlementId;
    const runRes = await client.query<{ id: string; status: string; deduction_journal_entry_id: string | null }>(
      `SELECT id::text, status, deduction_journal_entry_id::text
         FROM driver_finance.driver_settlement_gl_runs
        WHERE operating_company_id = $1::uuid AND settlement_id = $2::uuid LIMIT 1 FOR UPDATE`,
      [opco, settlementId]
    );
    const run = runRes.rows[0] ?? null;
    if (!run || run.status !== "posted") {
      return { result: "nothing_to_reverse", settlement_id: settlementId, run_id: run?.id ?? null };
    }

    const r = await client.query<{
      driver_bill_id: string;
      accounting_bill_id: string;
      bill_journal_entry_id: string | null;
      cash_bill_payment_id: string | null;
      cash_journal_entry_id: string | null;
      deduction_bill_payment_id: string | null;
    }>(
      `SELECT driver_bill_id::text, accounting_bill_id::text, bill_journal_entry_id::text,
              cash_bill_payment_id::text, cash_journal_entry_id::text,
              deduction_bill_payment_id::text
         FROM driver_finance.driver_settlement_gl_bills WHERE run_id = $1::uuid`,
      [run.id]
    );
    const glBills = r.rows;
    if (glBills.length === 0) {
      throw new SettlementBillPaymentError(
        "NO_LOAD_BILLS",
        `Settlement ${settlementId} has no linked GL bills to reverse`
      );
    }

    const originalJeIds: string[] = [];
    const reversalJeIds: string[] = [];

    // Reverse cash payments + bill A/P legs through the canonical posting engine, on THIS transaction.
    // No catch-and-ignore: PERIOD_LOCKED, missing source, linkage, or SQL failures abort and roll back all legs.
    for (const gb of glBills) {
      if (!gb.bill_journal_entry_id) {
        throw new SettlementBillPaymentError(
          "SOURCE_POSTING_LINK_MISSING",
          `Settlement ${settlementId} bill ${gb.accounting_bill_id} is missing its original journal-entry linkage`
        );
      }
      originalJeIds.push(gb.bill_journal_entry_id);

      if (gb.cash_bill_payment_id) {
        if (!gb.cash_journal_entry_id) {
          throw new SettlementBillPaymentError(
            "SOURCE_POSTING_LINK_MISSING",
            `Settlement ${settlementId} cash payment ${gb.cash_bill_payment_id} is missing its original journal-entry linkage`
          );
        }
        originalJeIds.push(gb.cash_journal_entry_id);
        const paymentReversal = await voidBillPaymentInClientTx(
          client,
          {
            operatingCompanyId: opco,
            paymentId: gb.cash_bill_payment_id,
            reason: input.reason,
            userId: actor.userId,
            reversePostedGl: true,
            currentBusinessDate,
          }
        );
        if (!paymentReversal.reversal_journal_entry_id) throw new Error("settlement_cash_payment_reversal_missing");
        reversalJeIds.push(paymentReversal.reversal_journal_entry_id);
      }

      if (gb.deduction_bill_payment_id) {
        await voidBillPaymentInClientTx(
          client,
          {
            operatingCompanyId: opco,
            paymentId: gb.deduction_bill_payment_id,
            reason: input.reason,
            userId: actor.userId,
            reversePostedGl: false,
            currentBusinessDate,
          }
        );
      }

      const billReversal = await voidBillInClientTx(
        client,
        {
          operatingCompanyId: opco,
          billId: gb.accounting_bill_id,
          reason: input.reason,
          userId: actor.userId,
          currentBusinessDate,
        }
      );
      // EXP-POSTED-NO-JE-01: voidBillInClientTx can now legitimately return a null
      // reversal_journal_entry_id for a bill that was never posted. That is not possible HERE —
      // this cascade only ever reaches a bill that was already part of a PAID settlement's own GL
      // run (driver_settlement_gl_bills), so its bill_journal_entry_id was already asserted
      // non-null above. A null reversal at this point means that bill's own posting silently
      // never happened despite the settlement reaching PAID — a real integrity gap, not something
      // to push a null into the equal-and-opposite proof below and let fail cryptically later.
      if (!billReversal.reversal_journal_entry_id) throw new Error("settlement_bill_reversal_missing");
      reversalJeIds.push(billReversal.reversal_journal_entry_id);
    }

    // Deduction JE uses the canonical linked JE reversal service. It enforces the SAME date policy as
    // bill/payment reversals (open original period -> original date; closed -> current company date),
    // writes deterministic void:journal_entry:<original-id> line idempotency + source links, and
    // serializes on the original JE row. No bespoke GL math.
    let deductionReversalJeId: string | null = null;
    if (run.deduction_journal_entry_id) {
      originalJeIds.push(run.deduction_journal_entry_id);
      const deductionReversal = await reverseJournalEntryNoFlip(client, {
        operatingCompanyId: opco,
        journalEntryId: run.deduction_journal_entry_id,
        reason: `Settlement ${settlementId}: ${input.reason}`,
        actorUserId: actor.userId,
        currentBusinessDate,
      });
      deductionReversalJeId = deductionReversal.reversal.reversal_journal_entry_id;
      if (!deductionReversalJeId) {
        throw new Error("settlement_deduction_reversal_missing");
      }
      reversalJeIds.push(deductionReversalJeId);
    }

    const restoredDeductions = await restoreSettlementDeductionsInClientTx(
      client,
      { operatingCompanyId: opco, settlementId, reason: input.reason },
      actor
    );

    const deductionProof = await client.query<{
      restored_count: number;
      restored_amount_cents: number;
      invalid_state_count: number;
      bucket_reversal_count: number;
      bucket_reversal_amount_cents: number;
      original_gl_cents: number;
      reversal_gl_cents: number;
    }>(
      `WITH restored AS (
         SELECT amount_cents,
                (applied_to_settlement_id IS NOT NULL OR status <> 'pending'
                  OR remaining_balance_cents <> amount_cents) AS invalid_state
           FROM driver_finance.driver_settlement_deductions
          WHERE operating_company_id = $1::uuid
            AND id = ANY($2::uuid[])
       ), bucket_reversals AS (
         SELECT amount_cents
           FROM driver_finance.driver_deduction_bucket_events
          WHERE operating_company_id = $1::uuid
            AND settlement_id = $3::uuid
            AND deduction_id = ANY($2::uuid[])
            AND event_type = 'reversal'
       )
       SELECT
         (SELECT COUNT(*)::int FROM restored) AS restored_count,
         (SELECT COALESCE(SUM(amount_cents),0)::bigint FROM restored) AS restored_amount_cents,
         (SELECT COUNT(*) FILTER (WHERE invalid_state)::int FROM restored) AS invalid_state_count,
         (SELECT COUNT(*)::int FROM bucket_reversals) AS bucket_reversal_count,
         (SELECT COALESCE(SUM(amount_cents),0)::bigint FROM bucket_reversals) AS bucket_reversal_amount_cents,
         (SELECT COALESCE(SUM(amount_cents),0)::bigint
            FROM accounting.journal_entry_postings
           WHERE operating_company_id = $1::uuid
             AND journal_entry_uuid = $4::uuid
             AND debit_or_credit = 'credit') AS original_gl_cents,
         (SELECT COALESCE(SUM(amount_cents),0)::bigint
            FROM accounting.journal_entry_postings
           WHERE operating_company_id = $1::uuid
             AND journal_entry_uuid = $5::uuid
             AND debit_or_credit = 'debit') AS reversal_gl_cents`,
      [
        opco,
        restoredDeductions.deduction_ids,
        settlementId,
        run.deduction_journal_entry_id,
        deductionReversalJeId,
      ]
    );
    const deductionReconciliation = deductionProof.rows[0];
    if (
      Number(deductionReconciliation?.restored_count ?? -1) !== restoredDeductions.deduction_count ||
      Number(deductionReconciliation?.restored_amount_cents ?? -1) !== restoredDeductions.total_amount_cents ||
      Number(deductionReconciliation?.invalid_state_count ?? -1) !== 0 ||
      Number(deductionReconciliation?.bucket_reversal_count ?? -1) !== restoredDeductions.bucketed_count ||
      Number(deductionReconciliation?.bucket_reversal_amount_cents ?? -1) !==
        restoredDeductions.bucketed_amount_cents ||
      Number(deductionReconciliation?.original_gl_cents ?? -1) !== restoredDeductions.total_amount_cents ||
      Number(deductionReconciliation?.reversal_gl_cents ?? -1) !== restoredDeductions.total_amount_cents
    ) {
      throw new Error("settlement_deduction_reconciliation_failed");
    }

    // Whole-settlement equal-and-opposite proof at the full accounting dimension grain. Every original
    // bill/payment/deduction JE and every reversal JE must be present exactly once, and their signed
    // amounts must net to zero by account + class + entity. A standalone-balanced reversal is insufficient.
    const allJeIds = [...originalJeIds, ...reversalJeIds];
    if (new Set(originalJeIds).size !== originalJeIds.length || new Set(reversalJeIds).size !== reversalJeIds.length) {
      throw new Error("settlement_reversal_duplicate_journal_link");
    }
    const proof = await client.query<{ journal_count: number; nonzero_dimensions: number; absolute_residual_cents: number }>(
      `
        WITH selected AS (
          SELECT journal_entry_uuid, account_id, class_id, entity_uuid,
                 CASE WHEN debit_or_credit = 'debit' THEN amount_cents ELSE -amount_cents END AS signed_cents
          FROM accounting.journal_entry_postings
          WHERE operating_company_id = $1::uuid
            AND journal_entry_uuid = ANY($2::uuid[])
        ),
        dimensional AS (
          SELECT account_id, class_id, entity_uuid, SUM(signed_cents)::bigint AS residual_cents
          FROM selected
          GROUP BY account_id, class_id, entity_uuid
        )
        SELECT
          (SELECT COUNT(DISTINCT journal_entry_uuid)::int FROM selected) AS journal_count,
          COUNT(*) FILTER (WHERE residual_cents <> 0)::int AS nonzero_dimensions,
          COALESCE(SUM(ABS(residual_cents)), 0)::bigint AS absolute_residual_cents
        FROM dimensional
      `,
      [opco, allJeIds]
    );
    const reconciliation = proof.rows[0];
    if (
      Number(reconciliation?.journal_count ?? 0) !== allJeIds.length ||
      Number(reconciliation?.nonzero_dimensions ?? 0) !== 0 ||
      Number(reconciliation?.absolute_residual_cents ?? 0) !== 0
    ) {
      throw new Error(
        `settlement_reversal_not_equal_and_opposite expected_journals=${allJeIds.length} ` +
          `actual_journals=${Number(reconciliation?.journal_count ?? 0)} ` +
          `nonzero_dimensions=${Number(reconciliation?.nonzero_dimensions ?? 0)} ` +
          `absolute_residual_cents=${Number(reconciliation?.absolute_residual_cents ?? 0)}`
      );
    }

    const driverBillIds = glBills.map((row) => row.driver_bill_id);
    if (new Set(driverBillIds).size !== driverBillIds.length) throw new Error("settlement_reversal_duplicate_driver_bill_link");
    const restoredDriverBills = await client.query<{ id: string }>(
      `UPDATE driver_finance.driver_bills
          SET status = 'open', settled_in_settlement_id = NULL, updated_at = now()
        WHERE operating_company_id = $1::uuid
          AND id = ANY($2::uuid[])
          AND settled_in_settlement_id = $3::uuid
          AND status = 'paid'
        RETURNING id::text`,
      [opco, driverBillIds, settlementId]
    );
    if (restoredDriverBills.rows.length !== driverBillIds.length) {
      throw new Error(`settlement_driver_bill_restore_incomplete expected=${driverBillIds.length} actual=${restoredDriverBills.rows.length}`);
    }

    const subledgerProof = await client.query<{
      active_payment_count: number;
      nonvoid_bill_count: number;
      nonzero_paid_bill_count: number;
      unrestored_driver_bill_count: number;
    }>(
      `WITH linked AS (
         SELECT accounting_bill_id, driver_bill_id, cash_bill_payment_id, deduction_bill_payment_id
           FROM driver_finance.driver_settlement_gl_bills WHERE run_id = $1::uuid
       ), payment_ids AS (
         SELECT cash_bill_payment_id AS id FROM linked WHERE cash_bill_payment_id IS NOT NULL
         UNION ALL
         SELECT deduction_bill_payment_id AS id FROM linked WHERE deduction_bill_payment_id IS NOT NULL
       )
       SELECT
         (SELECT COUNT(*)::int FROM accounting.bill_payments bp JOIN payment_ids p ON p.id = bp.id
           WHERE bp.operating_company_id = $2::uuid AND bp.revoked_at IS NULL) AS active_payment_count,
         (SELECT COUNT(*)::int FROM accounting.bills b JOIN linked l ON l.accounting_bill_id = b.id
           WHERE b.operating_company_id = $2::uuid AND b.revoked_at IS NULL) AS nonvoid_bill_count,
         (SELECT COUNT(*)::int FROM accounting.bills b JOIN linked l ON l.accounting_bill_id = b.id
           WHERE b.operating_company_id = $2::uuid AND COALESCE(b.paid_cents, 0) <> 0) AS nonzero_paid_bill_count,
         (SELECT COUNT(*)::int FROM driver_finance.driver_bills db JOIN linked l ON l.driver_bill_id = db.id
           WHERE db.operating_company_id = $2::uuid
             AND (db.status <> 'open' OR db.settled_in_settlement_id IS NOT NULL)) AS unrestored_driver_bill_count`,
      [run.id, opco]
    );
    const subledger = subledgerProof.rows[0];
    if (
      Number(subledger?.active_payment_count ?? -1) !== 0 ||
      Number(subledger?.nonvoid_bill_count ?? -1) !== 0 ||
      Number(subledger?.nonzero_paid_bill_count ?? -1) !== 0 ||
      Number(subledger?.unrestored_driver_bill_count ?? -1) !== 0
    ) {
      throw new Error(
        `settlement_subledger_reconciliation_failed active_payments=${Number(subledger?.active_payment_count ?? -1)} ` +
          `nonvoid_bills=${Number(subledger?.nonvoid_bill_count ?? -1)} ` +
          `nonzero_paid_bills=${Number(subledger?.nonzero_paid_bill_count ?? -1)} ` +
          `unrestored_driver_bills=${Number(subledger?.unrestored_driver_bill_count ?? -1)}`
      );
    }

    const transitioned = await client.query<{ id: string }>(
      `UPDATE driver_finance.driver_settlement_gl_runs
          SET status = 'reversed', reversed_at = now(), reversed_by_user_id = $2::uuid, reversal_reason = $3, updated_at = now()
        WHERE id = $1::uuid AND status = 'posted'
        RETURNING id::text`,
      [run.id, actor.userId, input.reason]
    );
    if (!transitioned.rows[0]?.id) throw new Error("settlement_reversal_state_transition_failed");
    await appendCrudAudit(
      client as never,
      actor.userId,
      "accounting.settlement.bill_payment_reversed",
      {
        resource_type: "driver_finance.driver_settlements",
        resource_id: settlementId,
        operating_company_id: opco,
        run_id: run.id,
        reason: input.reason,
        original_journal_entry_ids: originalJeIds,
        reversal_journal_entry_ids: reversalJeIds,
        reconciliation: {
          journal_count: allJeIds.length,
          nonzero_dimensions: 0,
          absolute_residual_cents: 0,
          active_payment_count: 0,
          nonvoid_bill_count: 0,
          nonzero_paid_bill_count: 0,
          unrestored_driver_bill_count: 0,
          restored_deduction_count: restoredDeductions.deduction_count,
          restored_deduction_amount_cents: restoredDeductions.total_amount_cents,
        },
      },
      "warning",
      "SETTLEMENT-BILL-PAYMENT"
    );

    return { result: "reversed", settlement_id: settlementId, run_id: run.id };
}
