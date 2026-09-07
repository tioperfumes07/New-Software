/**
 * SETTLEMENT PAY-RUN CLOSE — net-zero + escrow-cap + advance-recovery + flag-gate PROOF (real Postgres).
 * The money-path acceptance for the settlement pay-run (Phase 5). Runs only in CI (GITHUB_ACTIONS=true)
 * against a fully-migrated Postgres. Mirrors the harness/bootstrap of
 * accounting/settlement-posting/__tests__/settlement-bill-payment-posting.db.test.ts.
 *
 *  (1) escrow BELOW cap, flag ON  -> the pay-run JE BALANCES to the cent (sum debits == sum credits); the
 *      escrow credit lands on the driver's OWN Damage-Claim escrow LIABILITY sub-account; the un-recovered
 *      advance is marked recovered EXACTLY ONCE (recovered_in_settlement_id set); the net credits the
 *      payment-method's cash account; exactly ONE driver_finance.payrun_gl_runs anchor row.
 *  (2) escrow AT/OVER the $2,000 cap -> escrow_contribution == 0 (JE still balances).
 *  (3) flag OFF -> preview BALANCES but ZERO rows written to accounting.journal_entries/journal_entry_postings.
 *  (4) maker == checker cash-advance request is REJECTED (DB CHECK backstop); an Owner/authority request
 *      (reviewer NULL) and a distinct maker<>checker request are ALLOWED.
 *  (5) idempotent: a second flag-ON close does NOT double-post (still one JE, advance recovered once).
 */
import crypto, { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPgClientConfig } from "../../lib/pg-connection-options.js";
import {
  acquireGlobalAccountRoleBindingsLock,
  ensureIntegrationPrerequisites,
  releaseGlobalAccountRoleBindingsLock,
  restoreGlobalAccountRoleBindings,
  restoreGlobalCoaRoleDesignations,
  saveGlobalAccountRoleBindings,
  saveGlobalCoaRoleDesignations,
  type SavedAccountRoleBinding,
  type SavedCoaRoleDesignation,
} from "../../../test-helpers/db-fixture.js";
import { TEST_OWNER_USER_ID, TEST_ENCRYPTION_KEY } from "../../../test-helpers/constants.js";
import { upsertDriverEscrowAccountLink } from "../../accounting/driver-subaccount-provision.service.js";
import { closeSettlementPayRun, SettlementPayRunError } from "../settlement-payrun-close.service.js";
import { ESCROW_CAP_CENTS } from "../escrow-resolver.service.js";

const describeIntegration = describe.skipIf(process.env.GITHUB_ACTIONS !== "true");

// createJournalEntry unconditionally enqueues a QBO sync job (enqueueSyncJob -> getValidAccessToken) which
// needs an authorized integrations.qbo_connections row whose access_token decrypts under ENCRYPTION_KEY.
// MUST be the shared TEST_ENCRYPTION_KEY (vitest pool:"forks" reuses a child process across files).
process.env.ENCRYPTION_KEY ??= TEST_ENCRYPTION_KEY;
function encryptTestToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash("sha256").update(process.env.ENCRYPTION_KEY!, "utf8").digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

// Import the real constant — a duplicated literal here silently disagreed with the service when the
// owner raised the cap to $2,500 (C2b, 2026-07-26). A test that hardcodes the value it is meant to
// verify proves nothing.
const CAP = ESCROW_CAP_CENTS;

describeIntegration("SETTLEMENT PAY-RUN CLOSE net-zero (real Postgres)", () => {
  let db: pg.Client;
  let companyId: string;
  const suffix = randomUUID().slice(0, 8);
  const userId = TEST_OWNER_USER_ID;
  const realm = `PAYRUN-REALM-${suffix}`;

  // shared role-binding target accounts + payment method cash account (created once)
  const acct = {
    driverPay: randomUUID(),
    insuranceRecovery: randomUUID(),
    advanceClearing: randomUUID(),
    chargebackRecovery: randomUUID(),
    reimbursementExpense: randomUUID(),
    cash: randomUUID(),
  };
  // GLOBAL catalogs.account_role_bindings UNIQUE(role_key) — share lock with settlement-bill-payment +
  // settlement-gl-posting for save → bind → tests → fail-loud restore.
  const GLOBAL_BIND_KEYS = [
    "driver_pay_expense",
    "insurance_recovery",
    "advance_recovery",
    "abandonment_chargeback_recovery",
    "reimbursement_expense",
  ] as const;
  let priorGlobalBindings: SavedAccountRoleBinding[] = [];
  let priorCoaDesignations: SavedCoaRoleDesignation[] = [];
  let heldGlobalBindingsLock = false;
  const paymentMethodId = randomUUID();
  // per-driver escrow liability sub-accounts (grandparent -> parent -> per-driver leaf)
  const escrowGrandparent = randomUUID();
  const escrowParent = randomUUID();
  // Distinct, non-Faro (<> 1150040084) QBO ids per escrow account: uq_accounts_company_qbo_account_id forbids
  // reuse within a company, and the escrow resolver only requires a Liability that is NOT Faro (never a
  // specific id) — so each account in the Damage-Claim liability family carries its own id, as in prod.
  const escrowQbo = (tag: string) => `1150040187-${suffix}-${tag}`;

  type Scenario = { driverId: string; escrowSub: string; settlementId: string; displayId: string; advanceId?: string; liabilityId?: string };
  const below: Scenario = { driverId: randomUUID(), escrowSub: randomUUID(), settlementId: randomUUID(), displayId: `PR-BELOW-${suffix}` };
  const atcap: Scenario = { driverId: randomUUID(), escrowSub: randomUUID(), settlementId: randomUUID(), displayId: `PR-ATCAP-${suffix}` };
  const off: Scenario = { driverId: randomUUID(), escrowSub: randomUUID(), settlementId: randomUUID(), displayId: `PR-OFF-${suffix}` };
  // GO-22 B7 — same shape as `below` (gross 3000, advance 200 outstanding), dedicated so the
  // blocking-decision tests never share close-once-per-settlement state with (1)/(1b).
  const gate: Scenario = { driverId: randomUUID(), escrowSub: randomUUID(), settlementId: randomUUID(), displayId: `PR-GATE-${suffix}` };
  const mkUser1 = randomUUID();
  const mkUser2 = randomUUID();
  // Dedicated flag actor for THIS file only. The SETTLEMENT_GL_POSTING_ENABLED override is contended on
  // the SHARED TRANSP company by concurrent sibling real-Postgres suites (settlement-gl-posting.db.test.ts
  // + settlement-bill-payment-posting.db.test.ts) under vitest pool:"forks": their setFlag DELETE+INSERTs
  // the (flag_key, operating_company_id, user_uuid IS NULL) tenant row and their afterAll deletes EVERY
  // override for operating_company_id=companyId — so a company-scoped tenant override here can be flipped
  // OFF (or deleted) in the window between our setFlag(true) and closeSettlementPayRun's flag read, making
  // the run PREVIEW instead of POST. We instead pin a USER-scoped override to this dedicated actor
  // (operating_company_id NULL, user_uuid=flagActor) and drive closeSettlementPayRun AS that actor:
  // resolveFlagEnabled checks the per-user override FIRST (beats any tenant row), the siblings never touch
  // a user_uuid-non-NULL / company-NULL row, and they read with a DIFFERENT actor (TEST_OWNER) so they
  // never fetch ours — the flag state is immune in BOTH directions (no cross-suite contamination).
  const flagActor = randomUUID();
  const allDrivers = [below.driverId, atcap.driverId, off.driverId, gate.driverId];

  async function bypass(fn: () => Promise<void>) {
    await db.query("BEGIN");
    await db.query("SET LOCAL app.bypass_rls = 'lucia'");
    if (companyId) await db.query("SELECT set_config('app.operating_company_id', $1::text, true)", [companyId]);
    try { await fn(); await db.query("COMMIT"); }
    catch (e) { await db.query("ROLLBACK").catch(() => {}); throw e; }
  }
  async function read<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
    await db.query("BEGIN");
    await db.query("SET LOCAL app.bypass_rls = 'lucia'");
    await db.query("SELECT set_config('app.operating_company_id', $1::text, true)", [companyId]);
    try { const r = await db.query(sql, params); await db.query("COMMIT"); return r.rows as T[]; }
    catch (e) { await db.query("ROLLBACK").catch(() => {}); throw e; }
  }
  async function setFlag(enabled: boolean) {
    // USER-scoped (not company-scoped) so concurrent sibling suites on the SAME TRANSP company cannot race
    // this override (see flagActor note above). operating_company_id is NULL for a pure per-user override
    // (matches idx_ff_override_user + setOverride()); closeSettlementPayRun reads it AS flagActor.
    await bypass(async () => {
      await db.query(
        `DELETE FROM lib.feature_flag_overrides WHERE flag_key='SETTLEMENT_GL_POSTING_ENABLED' AND user_uuid=$1::uuid`,
        [flagActor]
      );
      await db.query(
        `INSERT INTO lib.feature_flag_overrides (flag_key, operating_company_id, user_uuid, enabled, set_by_user_uuid)
         VALUES ('SETTLEMENT_GL_POSTING_ENABLED', NULL, $1::uuid, $2, $3::uuid)`,
        [flagActor, enabled, userId]
      );
    });
  }

  async function mkAcct(id: string, name: string, type: string, parent: string | null, qbo: string | null) {
    await db.query(
      `INSERT INTO catalogs.accounts (id, operating_company_id, account_number, account_name, account_type, parent_account_id, qbo_account_id, is_postable)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,true)`,
      [id, companyId, `A-${id.slice(0, 8)}`, name, type, parent, qbo]
    );
  }
  async function bind(roleKey: string, accountId: string) {
    await db.query(
      `INSERT INTO catalogs.account_role_bindings (role_key, account_id, operating_company_id)
       VALUES ($1,$2::uuid,$3::uuid)
       ON CONFLICT (operating_company_id, role_key) WHERE (operating_company_id IS NOT NULL) DO UPDATE SET account_id = EXCLUDED.account_id, deactivated_at = NULL, operating_company_id = EXCLUDED.operating_company_id`,
      [roleKey, accountId, companyId]
    );
  }

  /** PRIMARY CoA-roles designation (resolver reads this first). */
  async function designate(role: string, accountId: string) {
    await db.query(
      `INSERT INTO accounting.chart_of_accounts_roles (operating_company_id, role, account_id, is_active)
       VALUES ($1::uuid,$2,$3::uuid,true)
       ON CONFLICT (operating_company_id, role) WHERE is_active
         DO UPDATE SET account_id = EXCLUDED.account_id, is_active = true`,
      [companyId, role, accountId]
    );
  }

  /** Seed a driver + its escrow leaf + bridge + a locked settlement (gross 3000). */
  async function seedDriverAndSettlement(s: Scenario, escrowBalanceCents: number) {
    await db.query(
      `INSERT INTO mdata.drivers (id, operating_company_id, first_name, last_name, phone)
       VALUES ($1::uuid,$2::uuid,'PayRun',$3,$4)`,
      [s.driverId, companyId, `D-${s.displayId}`, `+1006${randomUUID().slice(0, 7)}`]
    );
    await mkAcct(s.escrowSub, `${s.displayId} — Driver Escrow`, "Liability", escrowParent, escrowQbo(s.displayId));
    await upsertDriverEscrowAccountLink(db, { operatingCompanyId: companyId, driverId: s.driverId, coaAccountId: s.escrowSub });
    // ACCT-ESCROW-BALANCES-STALE-VS-GO19 (owner ruling 2026-09-05): readDriverEscrowBalanceCents now
    // reads the GL (accounting.escrow_accounts.balance_cents), not driver_finance.escrow_balances --
    // seed BOTH so the cap-check scenarios below (which assert escrow_balance_before_cents) still test
    // the real starting balance the resolver actually reads.
    await db.query(
      `UPDATE accounting.escrow_accounts SET balance_cents = $3 WHERE operating_company_id = $1::uuid AND holder_id = $2::uuid AND holder_type = 'driver'`,
      [companyId, s.driverId, escrowBalanceCents]
    );
    // running escrow balance (driver-facing projection; kept in sync by the real close path, no longer
    // the resolver's read source)
    await db.query(
      `INSERT INTO driver_finance.escrow_balances (operating_company_id, driver_id, total_held_cents, current_balance_cents)
       VALUES ($1::uuid,$2::uuid,$3,$3)
       ON CONFLICT (operating_company_id, driver_id) DO UPDATE SET current_balance_cents = EXCLUDED.current_balance_cents, total_held_cents = EXCLUDED.total_held_cents`,
      [companyId, s.driverId, escrowBalanceCents]
    );
    await db.query(
      `INSERT INTO driver_finance.driver_settlements
         (id, operating_company_id, display_id, driver_id, period_start, period_end, status, locked_at, gross_pay, deductions_total, reimbursements_total, net_pay)
       VALUES ($1::uuid,$2::uuid,$3,$4::uuid,CURRENT_DATE-7,CURRENT_DATE,'locked',now(),3000,0,0,0)`,
      [s.settlementId, companyId, s.displayId, s.driverId]
    );
    // a plain 'insurance' deduction (400.00) -> insurance_recovery role
    await db.query(
      `INSERT INTO driver_finance.driver_settlement_deductions
         (operating_company_id, driver_id, deduction_type, amount_cents, reason, applied_to_settlement_id, created_by_user_id)
       VALUES ($1::uuid,$2::uuid,'insurance',$3,'insurance recovery',$4::uuid,$5::uuid)`,
      [companyId, s.driverId, 40000, s.settlementId, userId]
    );
    // an abandonment chargeback line (100.00)
    await db.query(
      `INSERT INTO driver_finance.settlement_lines (settlement_id, line_type, description, amount)
       VALUES ($1::uuid,'abandonment_chargeback','abandonment chargeback',-100.00)`,
      [s.settlementId]
    );
    // an un-recovered outstanding advance (200.00) + its liability parent
    s.liabilityId = randomUUID();
    s.advanceId = randomUUID();
    await db.query(
      `INSERT INTO driver_finance.driver_liabilities (id, operating_company_id, driver_id, type, source_description, original_amount, current_balance)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'advance','pay-run advance',200.00,200.00)`,
      [s.liabilityId, companyId, s.driverId]
    );
    await db.query(
      `INSERT INTO driver_finance.driver_advances
         (id, operating_company_id, display_id, driver_id, liability_id, amount, purpose, disbursement_method, disbursement_status, recipient_type, created_by_user_id, status, outstanding_balance)
       VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,200.00,'fuel','ach','disbursed','driver',$6::uuid,'outstanding',200.00)`,
      [s.advanceId, companyId, `ADV-${s.displayId}`, s.driverId, s.liabilityId, userId]
    );
  }

  beforeAll(async () => {
    companyId = await ensureIntegrationPrerequisites();
    const cs = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL required");
    db = new pg.Client(buildPgClientConfig(cs));
    await db.connect();
    await db.query("SET ROLE ih35_app");
    await acquireGlobalAccountRoleBindingsLock(db);
    heldGlobalBindingsLock = true;
    await bypass(async () => {
      await db.query(
        `INSERT INTO identity.users (id, email, role, preferred_language) VALUES
           ($1::uuid,$2,'Owner','en'),($3::uuid,$4,'Dispatcher','en'),($5::uuid,$6,'Accountant','en'),
           ($7::uuid,$8,'Owner','en')
         ON CONFLICT (id) DO NOTHING`,
        [userId, `pr-owner-${suffix}@test.local`, mkUser1, `pr-mk-${suffix}@test.local`, mkUser2, `pr-ck-${suffix}@test.local`, flagActor, `pr-flag-${suffix}@test.local`]
      );
      // flagActor is the dedicated actor closeSettlementPayRun runs as (its per-user posting-flag override is
      // immune to sibling contamination — see note above). Grant it TRANSP access to mirror production Owners.
      await db.query(
        `INSERT INTO org.user_company_access (user_id, company_id) VALUES ($1::uuid,$2::uuid) ON CONFLICT (user_id, company_id) DO NOTHING`,
        [flagActor, companyId]
      );
      // shared role-target accounts
      await mkAcct(acct.driverPay, `Driver Pay Expense ${suffix}`, "Expense", null, null);
      await mkAcct(acct.insuranceRecovery, `Insurance Recovery ${suffix}`, "Liability", null, null);
      await mkAcct(acct.advanceClearing, `Advance Clearing ${suffix}`, "Asset", null, null);
      await mkAcct(acct.chargebackRecovery, `Chargeback Recovery ${suffix}`, "Income", null, null);
      await mkAcct(acct.reimbursementExpense, `Reimbursement Expense ${suffix}`, "Expense", null, null);
      await mkAcct(acct.cash, `Operating Cash ${suffix}`, "Asset", null, null);
      await mkAcct(escrowGrandparent, `Damage Claim Escrow ${suffix}`, "Liability", null, escrowQbo("GP"));
      await mkAcct(escrowParent, `Driver Escrow ${suffix}`, "Liability", escrowGrandparent, escrowQbo("P"));
      priorGlobalBindings = await saveGlobalAccountRoleBindings(db, GLOBAL_BIND_KEYS);
      // Snapshot SHARED-company PRIMARY designations BEFORE we overwrite them (sibling suites
      // need ap_control / uncategorized_expense intact — never wipe the whole company).
      priorCoaDesignations = await saveGlobalCoaRoleDesignations(db, companyId, GLOBAL_BIND_KEYS);
      // Legacy bindings kept as resolver FALLBACK tier (Rule 07) — prove primary path by also designating.
      await bind("driver_pay_expense", acct.driverPay);
      await bind("insurance_recovery", acct.insuranceRecovery);
      await bind("advance_recovery", acct.advanceClearing);
      await bind("abandonment_chargeback_recovery", acct.chargebackRecovery);
      await bind("reimbursement_expense", acct.reimbursementExpense);
      // PRIMARY designations — the tier closeSettlementPayRun resolves first after the CoA-resolver repoint.
      await designate("driver_pay_expense", acct.driverPay);
      await designate("insurance_recovery", acct.insuranceRecovery);
      await designate("advance_recovery", acct.advanceClearing);
      await designate("abandonment_chargeback_recovery", acct.chargebackRecovery);
      await designate("reimbursement_expense", acct.reimbursementExpense);
      // owner-editable payment method pinned to the cash account
      await db.query(
        // canonical 0152 table is code-keyed (code + display_name), not `name`.
        `INSERT INTO catalogs.payment_methods (id, operating_company_id, code, display_name, gl_account_id, is_active)
         VALUES ($1::uuid,$2::uuid,$3,$4,$5::uuid,true)`,
        [paymentMethodId, companyId, `ACH_${suffix}`, `ACH ${suffix}`, acct.cash]
      );
      await db.query(
        `INSERT INTO integrations.qbo_connections
           (operating_company_id, realm_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, authorized_by_user_id)
         VALUES ($1::uuid,$2,$3,$4, now()+interval '1 year', now()+interval '1 year', $5::uuid)
         ON CONFLICT (operating_company_id, realm_id) WHERE revoked_at IS NULL DO NOTHING`,
        [companyId, realm, encryptTestToken("t"), encryptTestToken("r"), userId]
      );
      await seedDriverAndSettlement(below, 50_000); // below cap -> contributes 25000
      await seedDriverAndSettlement(atcap, CAP);    // at cap    -> contributes 0
      await seedDriverAndSettlement(off, 50_000);   // flag-off preview
      await seedDriverAndSettlement(gate, 50_000);  // GO-22 B7 blocking-decision gate
      // ACCT-F5613 — an active reimbursement line (50.00) plus an INACTIVE one (999.00, must be
      // excluded by loadReimbursementsCents' is_active filter, same as the existing chargeback filter).
      await db.query(
        `INSERT INTO driver_finance.settlement_lines (settlement_id, line_type, description, amount, is_active)
         VALUES ($1::uuid,'reimbursement','tolls/scales reimbursement',50.00,true),
                ($1::uuid,'reimbursement','voided duplicate reimbursement',999.00,false)`,
        [off.settlementId]
      );
    });
  });

  afterAll(async () => {
    if (!db) return;
    let restoreError: unknown;
    const sids = [below.settlementId, atcap.settlementId, off.settlementId, gate.settlementId];
    // Fixture cleanup in its own txn — a failed DELETE must not abort GLOBAL restore.
    try {
      await bypass(async () => {
        await db.query(`DELETE FROM driver_finance.payrun_gl_runs WHERE settlement_id = ANY($1::uuid[])`, [sids]);
        // Drop posting→link FKs before deleting journal_entry_postings.
        await db.query(
          `DELETE FROM accounting.transaction_source_links tsl
            USING accounting.journal_entry_postings jep
            JOIN accounting.journal_entries je ON je.id = jep.journal_entry_uuid
           WHERE tsl.journal_entry_posting_id = jep.id
             AND je.operating_company_id = $1::uuid
             AND je.memo LIKE $2`,
          [companyId, `Settlement PR-%${suffix}%`]
        );
        await db.query(`DELETE FROM accounting.journal_entry_postings jep USING accounting.journal_entries je
                          WHERE je.id=jep.journal_entry_uuid AND je.operating_company_id=$1::uuid AND je.memo LIKE $2`, [companyId, `Settlement PR-%${suffix}%`]);
        await db.query(`DELETE FROM accounting.journal_entries WHERE operating_company_id=$1::uuid AND memo LIKE $2`, [companyId, `Settlement PR-%${suffix}%`]);
        await db.query(`DELETE FROM driver_finance.settlement_lines WHERE settlement_id = ANY($1::uuid[])`, [sids]);
        await db.query(`DELETE FROM driver_finance.driver_settlement_deductions WHERE applied_to_settlement_id = ANY($1::uuid[])`, [sids]);
        await db.query(`DELETE FROM driver_finance.driver_advances WHERE driver_id = ANY($1::uuid[])`, [allDrivers]);
        await db.query(`DELETE FROM driver_finance.driver_liabilities WHERE driver_id = ANY($1::uuid[])`, [allDrivers]);
        await db.query(`DELETE FROM driver_finance.escrow_ledger WHERE driver_id = ANY($1::uuid[])`, [allDrivers]);
        await db.query(`DELETE FROM driver_finance.escrow_balances WHERE driver_id = ANY($1::uuid[])`, [allDrivers]);
        await db.query(`DELETE FROM driver_finance.cash_advance_requests WHERE driver_id = ANY($1::uuid[])`, [allDrivers]);
        await db.query(`DELETE FROM driver_finance.driver_settlements WHERE id = ANY($1::uuid[])`, [sids]);
        await db.query(`DELETE FROM accounting.escrow_accounts WHERE holder_id = ANY($1::uuid[])`, [allDrivers]);
        await db.query(`DELETE FROM catalogs.payment_methods WHERE id=$1::uuid`, [paymentMethodId]);
        await db.query(`DELETE FROM mdata.drivers WHERE id = ANY($1::uuid[])`, [allDrivers]);
        await db.query(`DELETE FROM lib.feature_flag_overrides WHERE flag_key='SETTLEMENT_GL_POSTING_ENABLED' AND (operating_company_id=$1::uuid OR user_uuid=$2::uuid)`, [companyId, flagActor]);
        await db.query(`DELETE FROM integrations.qbo_connections WHERE operating_company_id=$1::uuid AND realm_id=$2`, [companyId, realm]);
      });
    } catch (fixtureCleanupErr) {
      void fixtureCleanupErr;
    }

    try {
      // Restore GLOBAL legacy bindings + PRIMARY CoA designations BEFORE deleting fixture accounts (FK).
      // FAIL-LOUD — own txn. Never wipe all chart_of_accounts_roles for the shared company
      // (that deleted ap_control and flaked bulk-post-as-bill / CI build-typecheck).
      await bypass(async () => {
        await restoreGlobalAccountRoleBindings(db, GLOBAL_BIND_KEYS, priorGlobalBindings, companyId);
        await restoreGlobalCoaRoleDesignations(db, companyId, GLOBAL_BIND_KEYS, priorCoaDesignations);
      });
    } catch (err) {
      restoreError = err;
    }

    try {
      await bypass(async () => {
        await db.query(`DELETE FROM catalogs.accounts WHERE id = ANY($1::uuid[])`, [
          [below.escrowSub, atcap.escrowSub, off.escrowSub, gate.escrowSub, escrowParent, escrowGrandparent, acct.driverPay, acct.insuranceRecovery, acct.advanceClearing, acct.chargebackRecovery, acct.reimbursementExpense, acct.cash],
        ]);
      });
    } catch (postRestoreCleanupErr) {
      void postRestoreCleanupErr;
    }

    if (heldGlobalBindingsLock) {
      try {
        await releaseGlobalAccountRoleBindingsLock(db);
      } catch (unlockErr) {
        restoreError ??= unlockErr;
      }
      heldGlobalBindingsLock = false;
    }
    await db.end();
    if (restoreError) throw restoreError;
  });

  async function jeBalance(jeId: string): Promise<{ dr: number; cr: number }> {
    const rows = await read<{ dr: string; cr: string }>(
      `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE debit_or_credit='debit'),0)::text AS dr,
              COALESCE(SUM(amount_cents) FILTER (WHERE debit_or_credit='credit'),0)::text AS cr
         FROM accounting.journal_entry_postings WHERE journal_entry_uuid=$1::uuid`,
      [jeId]
    );
    return { dr: Number(rows[0]!.dr), cr: Number(rows[0]!.cr) };
  }

  it("(1) below-cap flag-ON: JE balances to the cent; escrow->driver liability sub; advance recovered once; net->cash", async () => {
    await setFlag(true);
    const res = await closeSettlementPayRun(
      { operatingCompanyId: companyId, settlementId: below.settlementId, paymentMethodId },
      { userId: flagActor }
    );
    expect(res.result).toBe("posted");
    expect(res.journal_entry_id).toBeTruthy();
    // breakdown: gross 300000, ded 40000, chargeback 10000, advance 20000, escrow 25000, net 205000
    expect(res.breakdown.gross_cents).toBe(300000);
    expect(res.breakdown.deductions_cents).toBe(40000);
    expect(res.breakdown.chargebacks_cents).toBe(10000);
    expect(res.breakdown.advance_recoveries_cents).toBe(20000);
    expect(res.breakdown.escrow_contribution_cents).toBe(25000);
    expect(res.breakdown.net_cents).toBe(205000);

    // JE balances to the cent
    const bal = await jeBalance(res.journal_entry_id!);
    expect(bal.dr).toBe(bal.cr);
    expect(bal.dr).toBe(300000);

    // escrow credit lands on the driver's OWN Damage-Claim liability sub-account (parent set, Liability)
    const esc = await read<{ account_id: string; amount_cents: string; account_type: string; parent: string | null }>(
      `SELECT jep.account_id::text, jep.amount_cents::text, a.account_type, a.parent_account_id::text AS parent
         FROM accounting.journal_entry_postings jep JOIN catalogs.accounts a ON a.id = jep.account_id
        WHERE jep.journal_entry_uuid=$1::uuid AND jep.debit_or_credit='credit' AND jep.account_id=$2::uuid`,
      [res.journal_entry_id, below.escrowSub]
    );
    expect(esc.length).toBe(1);
    expect(Number(esc[0]!.amount_cents)).toBe(25000);
    expect(esc[0]!.account_type).toBe("Liability");
    expect(esc[0]!.parent).toBeTruthy();

    // net credits the payment-method's cash account
    const cash = await read<{ total: string }>(
      `SELECT COALESCE(SUM(amount_cents),0)::text AS total FROM accounting.journal_entry_postings
        WHERE journal_entry_uuid=$1::uuid AND debit_or_credit='credit' AND account_id=$2::uuid`,
      [res.journal_entry_id, acct.cash]
    );
    expect(Number(cash[0]!.total)).toBe(205000);

    // advance marked recovered EXACTLY ONCE
    expect(res.recovered_advance_ids).toEqual([below.advanceId]);
    const adv = await read<{ recovered: string | null; status: string }>(
      `SELECT recovered_in_settlement_id::text AS recovered, status FROM driver_finance.driver_advances WHERE id=$1::uuid`,
      [below.advanceId]
    );
    expect(adv[0]!.recovered).toBe(below.settlementId);
    expect(adv[0]!.status).toBe("recovered");

    // exactly ONE payrun_gl_runs anchor
    const runs = await read<{ c: string }>(`SELECT count(*)::text AS c FROM driver_finance.payrun_gl_runs WHERE settlement_id=$1::uuid`, [below.settlementId]);
    expect(Number(runs[0]!.c)).toBe(1);

    // SETL-POST-01 — a real post through this poster stamps the header's posted_at/posted_by_user_id
    // (migration 202607520000 added the columns; this is the writer-repoint that never landed until now).
    const posted = await read<{ posted_at: string | null; posted_by_user_id: string | null }>(
      `SELECT posted_at::text, posted_by_user_id::text FROM driver_finance.driver_settlements WHERE id=$1::uuid`,
      [below.settlementId]
    );
    expect(posted[0]!.posted_at).toBeTruthy();
    expect(posted[0]!.posted_by_user_id).toBe(flagActor);
  });

  it("(1b) idempotent: a second flag-ON close does not double-post (one JE, advance recovered once)", async () => {
    await setFlag(true);
    const res2 = await closeSettlementPayRun(
      { operatingCompanyId: companyId, settlementId: below.settlementId, paymentMethodId },
      { userId: flagActor }
    );
    expect(res2.result).toBe("posted");
    // no new advances recovered on the re-run (already recovered)
    expect(res2.recovered_advance_ids).toEqual([]);
    const runs = await read<{ c: string }>(`SELECT count(*)::text AS c FROM driver_finance.payrun_gl_runs WHERE settlement_id=$1::uuid`, [below.settlementId]);
    expect(Number(runs[0]!.c)).toBe(1);
    const jes = await read<{ c: string }>(
      `SELECT count(*)::text AS c FROM accounting.journal_entries WHERE operating_company_id=$1::uuid AND memo LIKE $2`,
      [companyId, `Settlement ${below.displayId}%`]
    );
    expect(Number(jes[0]!.c)).toBe(1);
  });

  it("(2) at/over cap: escrow_contribution == 0 and the JE still balances", async () => {
    await setFlag(true);
    const res = await closeSettlementPayRun(
      { operatingCompanyId: companyId, settlementId: atcap.settlementId, paymentMethodId },
      { userId: flagActor }
    );
    expect(res.result).toBe("posted");
    expect(res.breakdown.escrow_balance_before_cents).toBe(CAP);
    expect(res.breakdown.escrow_contribution_cents).toBe(0);
    // net = 300000 - 40000 - 0 - 20000 - 10000 = 230000
    expect(res.breakdown.net_cents).toBe(230000);
    const bal = await jeBalance(res.journal_entry_id!);
    expect(bal.dr).toBe(bal.cr);
    // no escrow leg on the driver's escrow sub-account
    const esc = await read<{ c: string }>(
      `SELECT count(*)::text AS c FROM accounting.journal_entry_postings WHERE journal_entry_uuid=$1::uuid AND account_id=$2::uuid`,
      [res.journal_entry_id, atcap.escrowSub]
    );
    expect(Number(esc[0]!.c)).toBe(0);
  });

  it("(3) flag OFF: preview balances but ZERO journal entries / postings are written", async () => {
    await setFlag(false);
    const res = await closeSettlementPayRun(
      { operatingCompanyId: companyId, settlementId: off.settlementId, paymentMethodId },
      { userId: flagActor }
    );
    expect(res.result).toBe("previewed");
    expect(res.posting_enabled).toBe(false);
    expect(res.journal_entry_id).toBeNull();
    // ACCT-F5613 — the active $50.00 reimbursement is included; the INACTIVE $999.00 one is not
    // (mirrors the is_active filter already proven on chargebacks).
    expect(res.breakdown.reimbursements_cents).toBe(5000);
    expect(res.breakdown.net_cents).toBe(210000); // 300000 + 5000 - 40000 - 25000 - 20000 - 10000
    const reimbLeg = res.je_preview.find((l) => l.account_id === acct.reimbursementExpense);
    expect(reimbLeg?.debit_or_credit).toBe("debit");
    expect(reimbLeg?.amount_cents).toBe(5000);
    // preview legs balance
    const dr = res.je_preview.filter((l) => l.debit_or_credit === "debit").reduce((s, l) => s + l.amount_cents, 0);
    const cr = res.je_preview.filter((l) => l.debit_or_credit === "credit").reduce((s, l) => s + l.amount_cents, 0);
    expect(dr).toBe(cr);
    expect(dr).toBe(305000); // gross 300000 + reimbursements 5000
    // NOTHING written
    const jes = await read<{ c: string }>(
      `SELECT count(*)::text AS c FROM accounting.journal_entries WHERE operating_company_id=$1::uuid AND memo LIKE $2`,
      [companyId, `Settlement ${off.displayId}%`]
    );
    expect(Number(jes[0]!.c)).toBe(0);
    const runs = await read<{ c: string }>(`SELECT count(*)::text AS c FROM driver_finance.payrun_gl_runs WHERE settlement_id=$1::uuid`, [off.settlementId]);
    expect(Number(runs[0]!.c)).toBe(0);
    // advance NOT recovered under preview
    const adv = await read<{ recovered: string | null }>(
      `SELECT recovered_in_settlement_id::text AS recovered FROM driver_finance.driver_advances WHERE id=$1::uuid`,
      [off.advanceId]
    );
    expect(adv[0]!.recovered).toBeNull();
    // SETL-POST-01 — preview must never stamp posted_at either (flag-OFF writes NOTHING).
    const posted = await read<{ posted_at: string | null }>(
      `SELECT posted_at::text FROM driver_finance.driver_settlements WHERE id=$1::uuid`,
      [off.settlementId]
    );
    expect(posted[0]!.posted_at).toBeNull();
  });

  it("(4) maker==checker cash-advance is rejected; authority (reviewer NULL) and distinct maker<>checker allowed", async () => {
    // maker == checker -> DB CHECK (cash_advance_requests_maker_ne_checker) rejects. The raw insert must
    // supply the base-table NOT-NULL-no-default columns (display_id, submitted_via, reason) so the row
    // reaches the maker<>checker CHECK instead of tripping a not-null on display_id first (0131 base DDL).
    await expect(
      read(
        `INSERT INTO driver_finance.cash_advance_requests
           (operating_company_id, driver_id, display_id, submitted_via, reason, requested_amount_cents, submitted_by_user_id, reviewed_by_user_id)
         VALUES ($1::uuid,$2::uuid,$4,'office','maker equals checker rejection test',5000,$3::uuid,$3::uuid)`,
        [companyId, below.driverId, mkUser1, `CAR-MK-${suffix}`]
      )
    ).rejects.toThrow(/maker_ne_checker|check/i);
    // Owner/authority auto-approve leaves reviewer NULL -> allowed
    await bypass(async () => {
      await db.query(
        `INSERT INTO driver_finance.cash_advance_requests
           (operating_company_id, driver_id, display_id, submitted_via, reason, requested_amount_cents, submitted_by_user_id, reviewed_by_user_id)
         VALUES ($1::uuid,$2::uuid,$4,'office','owner authority auto-approve test',5000,$3::uuid,NULL)`,
        [companyId, below.driverId, userId, `CAR-NULL-${suffix}`]
      );
    });
    // distinct maker <> checker -> allowed
    await bypass(async () => {
      await db.query(
        `INSERT INTO driver_finance.cash_advance_requests
           (operating_company_id, driver_id, display_id, submitted_via, reason, requested_amount_cents, submitted_by_user_id, reviewed_by_user_id)
         VALUES ($1::uuid,$2::uuid,$5,'office','distinct maker and checker test',5000,$3::uuid,$4::uuid)`,
        [companyId, below.driverId, mkUser1, mkUser2, `CAR-DIST-${suffix}`]
      );
    });
    const c = await read<{ c: string }>(`SELECT count(*)::text AS c FROM driver_finance.cash_advance_requests WHERE driver_id=$1::uuid`, [below.driverId]);
    expect(Number(c[0]!.c)).toBe(2);
  });

  // ACCT-F5697 — the mutual-exclusion interlock with the OTHER settlement GL poster
  // (accounting/settlement-posting/settlement-bill-payment-posting.service.ts's
  // postSettlementBillPayment). Live-verified on prod: S-2026-0002 was posted by BOTH posters
  // (bill-payment on 2026-08-11, this pay-run close on 2026-08-21) — Cost of Labor booked twice,
  // operating bank overcredited by the full gross a second time. Real DB, real anchor-table shape
  // (not a mock) — driver_finance.driver_settlement_gl_runs + driver_settlement_gl_bills rows exactly
  // as postSettlementBillPayment's own claim would leave them (ACCT-F348's own completion signal:
  // status='posted' AND a bill_journal_entry_id actually present).
  it("(5) ACCT-F5697: refuses when driver_settlement_gl_runs already shows this settlement posted by the OTHER poster", async () => {
    const interlockDriverId = randomUUID();
    const interlockSettlementId = randomUUID();
    const interlockDisplayId = `PR-INTERLOCK-${suffix}`;
    await bypass(async () => {
      await db.query(
        `INSERT INTO mdata.drivers (id, operating_company_id, first_name, last_name, phone)
         VALUES ($1::uuid,$2::uuid,'Interlock',$3,$4)`,
        [interlockDriverId, companyId, `D-${interlockDisplayId}`, `+1007${randomUUID().slice(0, 7)}`]
      );
      await db.query(
        `INSERT INTO driver_finance.driver_settlements
           (id, operating_company_id, display_id, driver_id, period_start, period_end, status, locked_at, gross_pay, deductions_total, reimbursements_total, net_pay)
         VALUES ($1::uuid,$2::uuid,$3,$4::uuid,CURRENT_DATE-7,CURRENT_DATE,'locked',now(),297.60,0,0,297.60)`,
        [interlockSettlementId, companyId, interlockDisplayId, interlockDriverId]
      );
      // The other poster's own full FK chain (driver_settlement_gl_bills' driver_bill_id /
      // accounting_bill_id / bill_journal_entry_id are all real FKs, not free-floating uuids) — a
      // minimal load + driver_bills + accounting.bills row, then the anchor row shaped exactly as
      // postSettlementBillPayment's own claim would leave it. The interlock query only checks
      // status/bill_journal_entry_id presence, not JE/bill content.
      const otherRunId = randomUUID();
      const otherJeId = randomUUID();
      const otherLoadId = randomUUID();
      const otherDriverBillId = randomUUID();
      const otherAccountingBillId = randomUUID();
      const otherCustomerId = randomUUID();
      await db.query(
        `INSERT INTO mdata.customers (id, operating_company_id, customer_name) VALUES ($1::uuid,$2::uuid,$3)`,
        [otherCustomerId, companyId, `ACCT-F5697 test customer ${suffix}`]
      );
      await db.query(
        `INSERT INTO mdata.loads (id, operating_company_id, load_number, customer_id, status, rate_total_cents, dispatcher_user_id, load_trailer_equipment_id)
         VALUES ($1::uuid,$2::uuid,$3,$4::uuid,'delivered_pending_docs',29760,$5::uuid,(SELECT id FROM catalogs.load_trailer_equipment WHERE operating_company_id = $2::uuid AND code = 'DRY_VAN' LIMIT 1))`,
        [otherLoadId, companyId, `L-INTERLOCK-${suffix}`, otherCustomerId, userId]
      );
      await db.query(
        `INSERT INTO driver_finance.driver_bills (id, operating_company_id, load_id, load_number, bill_number, driver_id, gross_amount_cents, status, settled_in_settlement_id)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,29760,'open',$7::uuid)`,
        [otherDriverBillId, companyId, otherLoadId, `L-INTERLOCK-${suffix}`, `DB-INTERLOCK-${suffix}`, interlockDriverId, interlockSettlementId]
      );
      await db.query(
        `INSERT INTO accounting.bills (id, operating_company_id, amount_cents, is_sample_data) VALUES ($1::uuid,$2::uuid,29760,true)`,
        [otherAccountingBillId, companyId]
      );
      await db.query(
        `INSERT INTO accounting.journal_entries (id, operating_company_id, entry_date, memo, status, source, is_sample_data)
         VALUES ($1::uuid,$2::uuid,CURRENT_DATE,'ACCT-F5697 test fixture — other poster','posted','auto',true)`,
        [otherJeId, companyId]
      );
      await db.query(
        `INSERT INTO driver_finance.driver_settlement_gl_runs
           (id, operating_company_id, settlement_id, driver_id, driver_vendor_id, run_key, gross_cents, deductions_cents, net_cents, status, posted_by_user_id)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'test-vendor',$5,29760,0,29760,'posted',$6::uuid)`,
        [otherRunId, companyId, interlockSettlementId, interlockDriverId, `interlock-${suffix}`, userId]
      );
      await db.query(
        `INSERT INTO driver_finance.driver_settlement_gl_bills
           (operating_company_id, run_id, settlement_id, driver_bill_id, load_id, accounting_bill_id, bill_journal_entry_id)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid)`,
        [companyId, otherRunId, interlockSettlementId, otherDriverBillId, otherLoadId, otherAccountingBillId, otherJeId]
      );
    });

    await setFlag(true);
    await expect(
      closeSettlementPayRun(
        { operatingCompanyId: companyId, settlementId: interlockSettlementId, paymentMethodId },
        { userId: flagActor }
      )
    ).rejects.toMatchObject({ code: "SETTLEMENT_ALREADY_POSTED_BY_OTHER_POSTER" });
    await expect(
      closeSettlementPayRun(
        { operatingCompanyId: companyId, settlementId: interlockSettlementId, paymentMethodId },
        { userId: flagActor }
      )
    ).rejects.toBeInstanceOf(SettlementPayRunError);

    // The whole point: refusing must mean NOTHING hit the ledger from THIS poster.
    const runs = await read<{ c: string }>(
      `SELECT count(*)::text AS c FROM driver_finance.payrun_gl_runs WHERE settlement_id=$1::uuid`,
      [interlockSettlementId]
    );
    expect(Number(runs[0]!.c)).toBe(0);
  });

  // GO-22 B7 (owner direct instruction, 2026-09-02): "If the driver has ANY outstanding loan or
  // debt... a window MUST appear and ask. IT CANNOT BE DEFERRED... the decision MUST BE
  // REGISTERED." requireLoanDecision:true is what the real payrun-close ROUTE always sets — these
  // two cases are that route's contract, proven against real Postgres, not a mock.

  it("(6) B7 blocking gate: requireLoanDecision + an outstanding advance + no decision -> refused, nothing written", async () => {
    await setFlag(true);
    await expect(
      closeSettlementPayRun(
        { operatingCompanyId: companyId, settlementId: gate.settlementId, paymentMethodId, requireLoanDecision: true },
        { userId: flagActor }
      )
    ).rejects.toMatchObject({
      code: "OUTSTANDING_LOAN_DECISION_REQUIRED",
      details: expect.objectContaining({ total_recoverable_cents: 20000 }),
    });
    // Refused before any write — same "nothing hits the ledger" proof as (5).
    const runs = await read<{ c: string }>(`SELECT count(*)::text AS c FROM driver_finance.payrun_gl_runs WHERE settlement_id=$1::uuid`, [gate.settlementId]);
    expect(Number(runs[0]!.c)).toBe(0);
    const adv = await read<{ status: string }>(`SELECT status FROM driver_finance.driver_advances WHERE id=$1::uuid`, [gate.advanceId]);
    expect(adv[0]!.status).not.toBe("recovered");
  });

  it("(6b) B7 blocking gate: mode:'full' decision proceeds identically to (1)'s pre-existing default — same numbers, decision registered in the audit trail", async () => {
    await setFlag(true);
    const res = await closeSettlementPayRun(
      {
        operatingCompanyId: companyId,
        settlementId: gate.settlementId,
        paymentMethodId,
        requireLoanDecision: true,
        loanRecoveryDecision: { mode: "full", decided_by_user_id: flagActor, reason: "standing policy — full recovery" },
      },
      { userId: flagActor }
    );
    expect(res.result).toBe("posted");
    // Identical numbers to (1)'s below-cap scenario — same fixture shape, proves the decision
    // path and the pre-existing default path produce the SAME result for mode:'full'.
    expect(res.breakdown.advance_recoveries_cents).toBe(20000);
    expect(res.breakdown.net_cents).toBe(205000);
    expect(res.recovered_advance_ids).toEqual([gate.advanceId]);

    const adv = await read<{ recovered: string | null; status: string; outstanding_balance: string }>(
      `SELECT recovered_in_settlement_id::text AS recovered, status, outstanding_balance::text FROM driver_finance.driver_advances WHERE id=$1::uuid`,
      [gate.advanceId]
    );
    expect(adv[0]!.recovered).toBe(gate.settlementId);
    expect(adv[0]!.status).toBe("recovered");
    expect(Number(adv[0]!.outstanding_balance)).toBe(0);

    // The decision itself is registered — who, when (created_at), what was chosen.
    const auditRows = await read<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM audit.audit_events
        WHERE event_class = 'driver_finance.settlement.loan_recovery_decision'
          AND payload->>'settlement_id' = $1
        ORDER BY created_at DESC LIMIT 1`,
      [gate.settlementId]
    );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0]!.payload).toMatchObject({ mode: "full", decided_by_user_id: flagActor, applied_this_close_cents: 20000, rolled_forward_cents: 0 });
  });
});
