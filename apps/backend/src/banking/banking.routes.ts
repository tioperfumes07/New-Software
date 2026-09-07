import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { withCurrentUser } from "../auth/db.js";
import { requireAuth } from "../auth/session-middleware.js";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
import { countPendingBills } from "../kpi/canonical-kpis.js";
import {
  bankAccountHiddenFilterSql,
  hideBankAccountForEntity,
  isBankAccountHideAdminRole,
  isBankAccountHideEnabled,
  unhideBankAccountForEntity,
} from "./bank-account-visibility.js";
import { countDriverEscrowKpis } from "./driver-escrow-counts.js";
import { countTotalBankTransactions, countUncategorizedTransactions } from "./pending-categorization.js";
import { bankingRuleMatches, type BankingRuleRow } from "./banking-rules.engine.js";
import { reverseJournalEntryNoFlip } from "../accounting/journal-entries.service.js";
import { POSTING_ENGINE_SUPPORTS_REPOST } from "../accounting/posting-engine.service.js";
import {
  sumAuthoritativeDepositoryCashCents,
  withInternalWalletBalances,
  withInternalWalletTileBalances,
  type BankAccountBalanceFields,
  type BankingTileBalanceFields,
} from "./internal-wallet-balance.js";

const companyQuerySchema = z.object({
  operating_company_id: z.string().uuid(),
});

const accountsAllQuerySchema = companyQuerySchema.extend({
  include_inactive: z.coerce.boolean().optional().default(false),
  // BANK-ACCOUNT-HIDE: the visibility manager (Owner/Administrator) passes true to see + toggle hidden
  // rows; every other consumer of this endpoint defaults to false so a hidden account stays fully
  // excluded everywhere (dashboards, pickers, categorization, reconciliation).
  include_hidden: z.coerce.boolean().optional().default(false),
});

const accountIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const registerQuerySchema = z.object({
  operating_company_id: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  // GO-19-02 (docs/lockdown/GO-19-BUILD-QUEUE.md slice 02): owner-only reveal toggle for the 34
  // already-voided USMCA GO-11 fixture rows. Default false so the register keeps showing the real
  // population; explicitly asking for it (include_sample_data=true) reveals the quarantined rows —
  // nothing is ever deleted, they just don't show unless asked.
  include_sample_data: z.coerce.boolean().default(false),
});

const transactionIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const splitBodySchema = z.object({
  operating_company_id: z.string().uuid(),
  lines: z
    .array(
      z.object({
        category: z.string().trim().min(1).max(120),
        amount: z.number(),
      })
    )
    .min(2),
});

const visibilityBodySchema = z.object({
  operating_company_id: z.string().uuid(),
  accounts: z
    .array(
      z.object({
        id: z.string().uuid(),
        visible: z.boolean(),
        display_order: z.number().int().nonnegative(),
        tag: z.string().trim().max(60).optional(),
        is_dip: z.boolean().optional(),
      })
    )
    .max(200),
});

function currentAuthUser(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user;
}

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: "validation_error", details: error.flatten() });
}

async function withCompanyScope<T>(
  userId: string,
  operatingCompanyId: string,
  fn: (client: {
    query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[]; rowCount?: number }>;
  }) => Promise<T>
) {
  await assertCompanyMembership(userId, operatingCompanyId);
  return withCurrentUser(userId, async (client) => {
    await client.query("SELECT set_config('app.operating_company_id', $1::text, true)", [operatingCompanyId]);
    return fn(client);
  });
}

async function hasRelation(client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<{ ok: boolean }> }> }, rel: string) {
  const res = await client.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [rel]);
  return Boolean(res.rows[0]?.ok);
}

function virtualKind(accountId: string) {
  if (accountId === "00000000-0000-0000-0000-000000000059") return "factoring";
  if (accountId === "00000000-0000-0000-0000-000000000056") return "escrow";
  if (accountId === "00000000-0000-0000-0000-000000000060") return "advance_pool";
  return null;
}

// ACCT-F5403 — GET /accounts/:id/register 400s "Invalid UUID" on every virtual account
// (factoring/escrow/advance_pool). accountIdParamsSchema's z.string().uuid() enforces the RFC 4122
// version/variant nibbles; the sentinel ids virtualKind() matches against (…059/…056/…060) are all
// version "0", so they fail that check before virtualKind() is ever reached — the register route has
// been unreachable for every virtual account since it shipped. hide/unhide (the other two callers of
// accountIdParamsSchema) act only on real bank accounts, so they correctly keep the strict schema;
// this route alone needs to accept a real account uuid OR one of the three known virtual sentinels.
const registerAccountIdParamsSchema = z.object({
  id: z.string().refine((v) => virtualKind(v) !== null || z.string().uuid().safeParse(v).success, {
    message: "Invalid account id",
  }),
});

export async function registerBankingRoutes(app: FastifyInstance) {
  app.get("/api/v1/banking/dashboard/kpis", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return sendValidationError(reply, query.error);
    const companyId = query.data.operating_company_id;

    const payload = await withCompanyScope(user.uuid, companyId, async (client) => {
      // BANK-ACCOUNT-HIDE: per-entity hidden accounts (flag OFF by default) must be excluded from every
      // cash/KPI surface — see docs/accounting/BANK-ACCOUNT-ENTITY-HIDE-DESIGN.md.
      const hideOn = await isBankAccountHideEnabled(client, companyId);
      const kpiRes = await client.query(
        `
          WITH tiles AS (
            SELECT t.*
            FROM views.banking_account_tiles t
            WHERE t.operating_company_id = $1::uuid
              AND (
                t.tile_kind <> 'real'
                OR EXISTS (
                  SELECT 1 FROM banking.bank_accounts b
                  WHERE b.id = t.id AND b.is_active = true
                  ${bankAccountHiddenFilterSql(hideOn, "b")}
                )
              )
          )
          SELECT
            $1::uuid AS operating_company_id,
            COALESCE(SUM(CASE WHEN tile_kind = 'real' THEN current_balance ELSE 0 END), 0) AS total_cash,
            COALESCE(SUM(CASE WHEN tag IN ('DIP Operating','DIP Payroll','DIP Other') THEN current_balance ELSE 0 END), 0) AS total_dip_cash,
            COALESCE(SUM(CASE WHEN tag = 'DIP Operating' THEN current_balance ELSE 0 END), 0) AS dip_operating,
            COALESCE(SUM(CASE WHEN tag = 'DIP Payroll' THEN current_balance ELSE 0 END), 0) AS dip_payroll,
            COALESCE(SUM(CASE WHEN tag = 'Factoring' THEN current_balance ELSE 0 END), 0) AS factoring_reserve,
            COALESCE(SUM(CASE WHEN tag = 'Escrow' THEN current_balance ELSE 0 END), 0) AS driver_escrow,
            COALESCE(SUM(uncategorized_count), 0) AS total_uncategorized
          FROM tiles
        `,
        [companyId]
      );
      // BANK-KPI-FAKE-ZERO-CATCH-CLUSTER (GO-0027, CC-1): these 4 KPI sub-queries used to swallow
      // their own failures behind a fake-zero .catch() — a real DB/RLS error rendered as a
      // normal-looking (but wrong) "0" instead of surfacing the frontend's already-built
      // kpiQuery.isError -> ListErrorBanner path (BankingHome.tsx:412). Matches the same fix
      // already shipped for the authoritative-cash leg below (PR #16817): let a real failure
      // propagate and 500, don't paint over it.
      const pendingBills = await countPendingBills(client, companyId);
      const escrowCounts = await countDriverEscrowKpis(client, companyId);
      // total_cash / cash-flow opening / accounts/all must agree via sumAuthoritativeDepositoryCashCents:
      // Plaid depository SUM(current_balance_cents) + non-Plaid internal-wallet ledger derivation.
      // Never re-sum bank_transactions for the Plaid-mixed population (phantom -$4.79M class).
      // BANK-KPI-FAKE-ZERO-CATCH-CLUSTER: this used to be `.catch(() => 0)` — a real failure resolving
      // the authoritative cash total silently painted "$0.00" over the KPI strip, indistinguishable
      // from an actually-empty account. The frontend's kpiQuery.isError -> ListErrorBanner path already
      // exists (BankingHome.tsx) for exactly this; it just never fired because this never threw.
      const authoritativeTotalCash = await sumAuthoritativeDepositoryCashCents(client, companyId, {
        hideFilterOnBankAccounts: bankAccountHiddenFilterSql(hideOn, "banking.bank_accounts"),
        hideFilterOnBaAlias: bankAccountHiddenFilterSql(hideOn, "ba"),
      });
      // BANKING-1: the UNCATEGORIZED headline must count the SAME population the Transactions
      // "For review" queue lists — entity-scoped status IN ('pending_categorization','uncategorized')
      // across all accounts. The tile view's uncategorized_count counts only 'uncategorized', so it
      // read 0 while ~2,650 CSV-imported 'pending_categorization' rows sat in the queue. One shared
      // count (pending-categorization.ts) now feeds both so they can never diverge.
      const uncategorizedCount = await countUncategorizedTransactions(client, companyId);
      // FIX-3: the Banking Home SyncStatusStrip "Transactions" metric must read the REAL bank-transaction
      // total from the canonical banking.bank_transactions table — NOT a count of qbo_sync_queue entities
      // in status 'synced' (that queue counts pushed-to-QBO entities of ANY type, not bank transactions,
      // and previously showed "Transactions: 0" for companies with hundreds of un-pushed transactions).
      const totalTransactions = await countTotalBankTransactions(client, companyId);
      return {
        ...(kpiRes.rows[0] ?? {
          operating_company_id: companyId,
          total_cash: 0,
          total_dip_cash: 0,
          dip_operating: 0,
          dip_payroll: 0,
          factoring_reserve: 0,
          driver_escrow: 0,
          total_uncategorized: 0,
        }),
        // BankingHome money.format expects dollars; sumAuthoritativeDepositoryCashCents is cents
        // (same raw total as cash-flow opening_cash_cents — do not assign cents here).
        total_cash: authoritativeTotalCash / 100,
        total_uncategorized: uncategorizedCount,
        total_transactions: totalTransactions,
        pending_bills: pendingBills,
        ...escrowCounts,
      };
    });
    return payload;
  });

  app.get("/api/v1/banking/account-tiles", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return sendValidationError(reply, query.error);
    const companyId = query.data.operating_company_id;

    const tiles = await withCompanyScope(user.uuid, companyId, async (client) => {
      const hideOn = await isBankAccountHideEnabled(client, companyId);
      // BANK-SURF-05: views.banking_account_tiles.is_relay is PHANTOM (never written). Real Relay
      // identity is catalogs.accounts.system_purpose = 'relay_fuel_wallet' via bank_accounts.ledger_account_id.
      const res = await client.query<BankingTileBalanceFields>(
        `
          SELECT
            t.*,
            ba.ledger_account_id,
            ba.plaid_item_id,
            ca.system_purpose,
            (ca.system_purpose = 'relay_fuel_wallet') AS is_relay_wallet
          FROM views.banking_account_tiles t
          LEFT JOIN banking.bank_accounts ba
            ON ba.id = t.id
           AND ba.operating_company_id = t.operating_company_id
          LEFT JOIN catalogs.accounts ca
            ON ca.id = ba.ledger_account_id
           AND ca.operating_company_id = ba.operating_company_id
          WHERE t.operating_company_id = $1::uuid
            AND (
              t.tile_kind <> 'real'
              OR EXISTS (
                SELECT 1 FROM banking.bank_accounts b
                WHERE b.id = t.id AND b.is_active = true
                ${bankAccountHiddenFilterSql(hideOn, "b")}
              )
            )
          ORDER BY t.display_order, t.account_type, t.display_name
        `,
        [companyId]
      );
      return withInternalWalletTileBalances(client, companyId, res.rows);
    });
    return { tiles };
  });

  app.get("/api/v1/banking/accounts/all", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const query = accountsAllQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return sendValidationError(reply, query.error);
    const companyId = query.data.operating_company_id;
    const includeInactive = query.data.include_inactive;
    const includeHidden = query.data.include_hidden;

    const accounts = await withCompanyScope(user.uuid, companyId, async (client) => {
      if (!(await hasRelation(client, "banking.bank_accounts"))) return [];
      const activeClause = includeInactive ? "" : " AND is_active = true";
      const hideOn = await isBankAccountHideEnabled(client, companyId);
      const hiddenClause = includeHidden ? "" : bankAccountHiddenFilterSql(hideOn, "banking.bank_accounts");
      const res = await client.query<BankAccountBalanceFields>(
        `
          SELECT *
          FROM banking.bank_accounts
          WHERE operating_company_id = $1::uuid
          ${activeClause}
          ${hiddenClause}
          ORDER BY display_order, display_name
        `,
        [companyId]
      );
      // RELAY-WALLET-BALANCE-1: current_balance_cents/available_balance_cents are Plaid-sync-only
      // columns — a non-Plaid internal wallet (Relay Fuel Wallet) never gets them updated and stays
      // frozen at its seed value of 0 forever. Derive from the account's own ledger instead.
      return withInternalWalletBalances(client, companyId, res.rows);
    });
    return { accounts };
  });

  // ── Petty Cash account creation (owner request 2026-09-06) ──────────────────────────────────────────
  // A Petty Cash account is a REAL banking.bank_accounts row (tile_kind='real'), created manually
  // (not via Plaid). It holds actual cash. When a check is generated (payBill with payment_method='check'),
  // the check amount posts a transfer FROM the source bank account TO this account.
  app.post("/api/v1/banking/accounts/petty-cash", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const body = z.object({
      operating_company_id: z.string().uuid(),
      display_name: z.string().trim().min(1).max(120).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) return sendValidationError(reply, body.error);
    const companyId = body.data.operating_company_id;
    await assertCompanyMembership(String(user.uuid), companyId);

    try {
      const account = await withCompanyScope(user.uuid, companyId, async (client) => {
        // Idempotent: if a petty cash account already exists for this entity, return it.
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM banking.bank_accounts WHERE operating_company_id = $1::uuid AND is_petty_cash = true AND is_active = true AND deactivated_at IS NULL LIMIT 1`,
          [companyId]
        );
        if (existing.rows[0]) return { id: existing.rows[0].id, already_existed: true };

        const inserted = await client.query<{ id: string }>(
          `
            INSERT INTO banking.bank_accounts (
              operating_company_id, account_name, display_name, account_type,
              current_balance_cents, available_balance_cents, currency_code,
              is_active, sync_status, is_petty_cash
            )
            VALUES ($1, $2, $2, 'petty_cash', 0, 0, 'USD', true, 'active', true)
            RETURNING id
          `,
          [companyId, body.data.display_name ?? "Petty Cash"]
        );
        await appendCrudAudit(
          client,
          String(user.uuid),
          "banking.bank_accounts.petty_cash_created",
          { resource_type: "banking.bank_accounts", resource_id: inserted.rows[0].id, operating_company_id: companyId },
          "info",
          "P5-T1.1-PETTY-CASH"
        );
        return { id: inserted.rows[0].id, already_existed: false };
      });
      return reply.code(201).send({ account });
    } catch (error) {
      return reply.code(500).send({ error: "petty_cash_create_failed", message: String((error as Error)?.message ?? "") });
    }
  });

  app.post("/api/v1/banking/accounts/visibility", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const body = visibilityBodySchema.safeParse(req.body ?? {});
    if (!body.success) return sendValidationError(reply, body.error);
    const b = body.data;

    const updated = await withCompanyScope(user.uuid, b.operating_company_id, async (client) => {
      if (!(await hasRelation(client, "banking.bank_accounts"))) return [];
      const rows: Record<string, unknown>[] = [];
      for (const account of b.accounts) {
        const res = await client.query(
          `
            UPDATE banking.bank_accounts
            SET visible = $2,
                display_order = $3,
                tag = COALESCE($4, tag),
                is_dip = COALESCE($5, is_dip)
            WHERE id = $1
              AND operating_company_id = $6::uuid
            RETURNING *
          `,
          [account.id, account.visible, account.display_order, account.tag ?? null, account.is_dip ?? null, b.operating_company_id]
        );
        if ((res.rowCount ?? 0) > 0) rows.push(res.rows[0]);
      }
      return rows;
    });
    return { updated_accounts: updated };
  });

  // Rate-limited like the other authorizing banking reads: this endpoint pages a full account register
  // and CodeQL (js/missing-rate-limiting) flags an authorizing route without one.
  app.get("/api/v1/banking/accounts/:id/register", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const params = registerAccountIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const query = registerQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return sendValidationError(reply, query.error);
    const q = query.data;

    const rows = await withCompanyScope(user.uuid, q.operating_company_id, async (client) => {
      // BANK-F9516: all four branches of this handler used to .catch(() => ({ rows: [] })) their
      // query — same fake-empty-200 class as BANK-F9514/F9515 (#17030, this same PR's F9515 fix).
      // accounting.factoring_advances / accounting.escrow_postings+escrow_accounts /
      // driver_finance.driver_advances / banking.bank_transactions are all foundational tables, not
      // conditionally created. Only the "escrow" branch currently has a live frontend consumer
      // (DriverEscrowTabContent.tsx's accountLedgerQuery, which already derives its error UI from
      // useListState(...).isError) — factoring/advance_pool/the real-bank-account branch have no
      // caller yet, but the fix is the same either way: a query failure should fail the request, not
      // silently report zero rows to whichever caller shows up next.
      const virtual = virtualKind(params.data.id);
      if (virtual === "factoring") {
        const res = await client.query(
          `
              SELECT
                fa.id,
                fa.created_at::date AS txn_date,
                COALESCE(fa.memo, fa.notes, 'Factoring activity') AS description,
                -- CLS-UNIT-SCALE (UNIT-002): the amount column is consumed as DOLLARS by the register — the
                -- escrow and advance_pool branches below both divide by 100. Emitting raw cents here
                -- displayed every factoring advance at 100x.
                (fa.advance_amount_cents::numeric / 100) AS amount,
                'virtual_factoring'::text AS category,
                'synced'::text AS status
              FROM accounting.factoring_advances fa
              WHERE fa.operating_company_id = $1::uuid
              ORDER BY fa.created_at DESC
              LIMIT $2 OFFSET $3
            `,
          [q.operating_company_id, q.limit, q.offset]
        );
        return res.rows;
      }
      if (virtual === "escrow") {
        const res = await client.query(
          `
              -- ACCT-F5703: repointed off driver_finance.escrow_ledger (near-empty, never kept in
              -- sync) onto accounting.escrow_postings/escrow_accounts — the real GL-linked liability
              -- subledger /accounting/escrow already reads correctly. driver_id is only meaningful for
              -- holder_type='driver' rows (this account-level register can also carry vendor/factor
              -- reserve postings); honestly NULL rather than mislabeling a non-driver holder.
              -- BANKING-DRIVER-ESCROW-REGISTER-MISSING-SETTLEMENT-JE-LINK — settlement_id/journal_entry_id
              -- were entirely absent from this query, even though ep.source_id/linked_journal_entry_id
              -- are populated on real rows and the frontend (DriverEscrowTabContent.tsx) was already
              -- correctly written to render an EntityLink for both — it never got the chance. Same
              -- CASE/join shape escrow-visualizer.routes.ts already uses in this same schema.
              -- BANK-F5751 (2026-08-22) — the fix above still left the Settlement column's LABEL
              -- hardcoded null on the frontend (only settlement_id, the raw uuid, was returned). This
              -- adds the missing driver_finance.driver_settlements join for a real settlement_display_id
              -- — live-confirmed against the same 2 rows: S-20260802-0258 / S-2026-0002.
              -- BANK-F6050 — registerToEscrowRow MUST copy settlement_display_id + journal_entry_id +
              -- journal_entry_memo through to the table row. Selecting them here is not enough; a
              -- mapper drop paints "Settlement — not visible" on rows whose description already has S-*.
              SELECT
                ep.id,
                ep.posted_at::date AS txn_date,
                COALESCE(ep.note, ep.posting_type, 'Escrow movement') AS description,
                (ep.amount_cents::numeric / 100) AS amount,
                ep.posting_type AS category,
                'synced'::text AS status,
                CASE WHEN ea.holder_type = 'driver' THEN ea.holder_id::text ELSE NULL END AS driver_id,
                CASE WHEN ep.source_type = 'driver_settlement' THEN ep.source_id::text ELSE NULL END AS settlement_id,
                ds.display_id AS settlement_display_id,
                ep.linked_journal_entry_id::text AS journal_entry_id,
                je.memo AS journal_entry_memo
              FROM accounting.escrow_postings ep
              JOIN accounting.escrow_accounts ea
                ON ea.id = ep.escrow_account_id
               AND ea.operating_company_id = ep.operating_company_id
              LEFT JOIN accounting.journal_entries je
                ON je.id = ep.linked_journal_entry_id
               AND je.operating_company_id = ep.operating_company_id
              LEFT JOIN driver_finance.driver_settlements ds
                ON ds.id = ep.source_id
               AND ep.source_type = 'driver_settlement'
               AND ds.operating_company_id = ep.operating_company_id
              WHERE ep.operating_company_id = $1::uuid
              ORDER BY ep.posted_at DESC
              LIMIT $2 OFFSET $3
            `,
          [q.operating_company_id, q.limit, q.offset]
        );
        return res.rows;
      }
      if (virtual === "advance_pool") {
        const res = await client.query(
          `
              SELECT
                da.id,
                da.created_at::date AS txn_date,
                COALESCE(da.memo, 'Cash advance outstanding') AS description,
                da.outstanding_balance AS amount,
                'cash_advance'::text AS category,
                'synced'::text AS status
              FROM driver_finance.driver_advances da
              WHERE da.operating_company_id = $1::uuid
                AND da.status = 'outstanding'
              ORDER BY da.created_at DESC
              LIMIT $2 OFFSET $3
            `,
          [q.operating_company_id, q.limit, q.offset]
        );
        return res.rows;
      }

      const res = await client.query(
        `
            SELECT
              bt.*,
              -- BANK-F10005 amendment (2026-09-04) — amount_cents's sign happens to run opposite
              -- is_credit on this table (Plaid convention: NEGATIVE = deposit, POSITIVE = withdrawal),
              -- so branching on sign(amount_cents) gave the right answer today, but only by matching
              -- an unenforced convention — a future write path that sets is_credit correctly without
              -- following this exact sign would silently swap the two columns again. Read is_credit
              -- directly, the authoritative direction column, instead of inferring from sign.
              CASE WHEN bt.is_credit THEN abs(bt.amount_cents)::numeric / 100 ELSE 0 END AS deposits,
              CASE WHEN NOT bt.is_credit THEN abs(bt.amount_cents)::numeric / 100 ELSE 0 END AS withdrawals
            FROM banking.bank_transactions bt
            WHERE bt.operating_company_id = $1::uuid
              AND bt.bank_account_id = $2
              -- GO-19-02: the 34 GO-11 fixture rows are voided AND is_sample_data=true — they stay
              -- hidden under the normal voided_at filter unless include_sample_data explicitly asks
              -- to reveal them. Every other voided (real) row stays excluded either way.
              AND (bt.voided_at IS NULL OR (bt.is_sample_data = true AND $5::boolean))
            ORDER BY bt.transaction_date DESC, bt.created_at DESC
            LIMIT $3 OFFSET $4
          `,
        [q.operating_company_id, params.data.id, q.limit, q.offset, q.include_sample_data]
      );
      return res.rows;
    });
    return { register_rows: rows };
  });

  app.get("/api/v1/banking/transactions/:id/suggestions", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const params = transactionIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return sendValidationError(reply, query.error);
    const companyId = query.data.operating_company_id;

    // BANK-F9521: the 3 .catch()es below used to silently swallow into an empty result with NO log
    // line at all — indistinguishable from "genuinely nothing to suggest". Unlike BANK-F9514/15/16/
    // 17/18/20 (primary data, each with a real isError banner already built and waiting), suggestions
    // are a deliberate best-effort enhancement — no frontend consumer here has (or should need) error
    // UI for "no suggestion available", and hard-failing this endpoint would turn a soft nice-to-have
    // into a broken categorization workflow for no product benefit. "Fail loud" for a genuinely
    // optional feature means LOUD IN THE LOGS, not loud to the end user: each catch now logs via
    // req.log.warn (the same pattern this file's own legitimate spine-event catches already use) so a
    // real failure is observable/debuggable, while the UI still degrades gracefully to "no suggestions".
    const { suggestions, ruleMatch } = await withCompanyScope(user.uuid, companyId, async (client) => {
      const targetRes = await client
        .query<{ description: string | null; amount_cents: number; bank_account_id: string }>(
          `
            SELECT description, amount_cents, bank_account_id::text
            FROM banking.bank_transactions
            WHERE id = $1
              AND operating_company_id = $2::uuid
            LIMIT 1
          `,
          [params.data.id, companyId]
        )
        .catch((err) => {
          req.log.warn({ err, bank_transaction_id: params.data.id, companyId }, "banking_suggestions_target_lookup_failed");
          return { rows: [] as { description: string | null; amount_cents: number; bank_account_id: string }[] };
        });
      const target = targetRes.rows[0];
      if (!target) return { suggestions: [], ruleMatch: null };
      const res = await client
        .query(
          `
            SELECT
              id,
              transaction_date AS txn_date,
              description,
              -- CLS-UNIT-SCALE (UNIT-003): same amount contract as the register — dollars, not cents.
              -- The $2 comparison below stays in CENTS on purpose: it matches amount_cents against the
              -- target's amount_cents with a 500-cent ($5) tolerance. Only the OUTPUT is scaled.
              (amount_cents::numeric / 100) AS amount,
              category,
              status
            FROM banking.bank_transactions
            WHERE operating_company_id = $1::uuid
              AND voided_at IS NULL
              AND NOT (status IN ('pending_categorization','uncategorized'))
              AND abs(amount_cents - $2) <= 500
              AND description ILIKE $3
            ORDER BY transaction_date DESC
            LIMIT 3
          `,
          [companyId, Number(target.amount_cents ?? 0), `%${String(target.description ?? "").slice(0, 18)}%`]
        )
        .catch((err) => {
          req.log.warn({ err, bank_transaction_id: params.data.id, companyId }, "banking_suggestions_similar_txn_lookup_failed");
          return { rows: [] as Record<string, unknown>[] };
        });

      // ACCT-F375 — accounting.banking_rules + banking-rules.engine.ts have
      // always WRITTEN suggested_account_id/suggested_vendor_id/suggested_confidence on
      // bank_transactions, but nothing anywhere READS those columns: no route selects them into a
      // response, no frontend file references them. The rule engine has been dead weight since it
      // shipped. This is the one endpoint the categorization UI actually calls for a suggestion
      // (apps/frontend/src/api/banking.ts), so it is where a rule match belongs. Reuses
      // bankingRuleMatches verbatim — no new matching logic, no new GL math, read-only.
      let ruleMatch: { rule_id: string; then_account_id: string; then_vendor_id: string | null } | null = null;
      const rulesRes = await client
        .query<BankingRuleRow>(
          `
            SELECT id, priority, description_contains, description_regex, amount_min_cents,
                   amount_max_cents, bank_account_filter_id, then_vendor_id, then_account_id
            FROM accounting.banking_rules
            WHERE operating_company_id = $1::uuid AND is_active = true
            ORDER BY priority DESC, created_at ASC
          `,
          [companyId]
        )
        .catch((err) => {
          req.log.warn({ err, companyId }, "banking_suggestions_rules_lookup_failed");
          return { rows: [] as BankingRuleRow[] };
        });
      for (const rule of rulesRes.rows) {
        if (
          bankingRuleMatches(rule, {
            description: target.description,
            amount_cents: Number(target.amount_cents ?? 0),
            bank_account_id: target.bank_account_id,
          })
        ) {
          ruleMatch = { rule_id: rule.id, then_account_id: rule.then_account_id, then_vendor_id: rule.then_vendor_id };
          break;
        }
      }
      return { suggestions: res.rows, ruleMatch };
    });
    return { suggestions, rule_match: ruleMatch };
  });

  app.post("/api/v1/banking/transactions/:id/split", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const params = transactionIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const body = splitBodySchema.safeParse(req.body ?? {});
    if (!body.success) return sendValidationError(reply, body.error);

    // SUPERSEDED (BANK-SPLIT-1, HOLD): the honest 501 stub above is retained for this legacy shallow
    // contract ({category, amount} only — no vendor/driver/unit/trailer/load linkage, no mode toggle). The
    // real, persisted, balanced N-line split now lives at PUT/POST /transactions/:id/splits (plural) —
    // see bank-transaction-splits.service.ts + categorization.routes.ts. This route stays a documented
    // 501 (never silently mis-categorizes) so any caller still on the old contract fails loud instead of
    // getting a wrong answer.
    return reply.code(501).send({
      error: "split_not_implemented",
      message:
        "This legacy split contract is retired. Use PUT /api/v1/banking/transactions/:id/splits (real, persisted, linked split lines).",
      transaction_id: params.data.id,
      requested_line_count: body.data.lines.length,
      see: "/api/v1/banking/transactions/:id/splits",
    });
  });

  app.post("/api/v1/banking/transactions/:id/undo-categorization", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const params = transactionIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return sendValidationError(reply, query.error);
    const companyId = query.data.operating_company_id;

    const ok = await withCompanyScope(user.uuid, companyId, async (client) => {
      // BANK-F01 — undoing a categorization MUST reverse the journal entry it posted.
      //
      // THE DEFECT THIS CLOSES. This handler used to clear the categorization fields and leave
      // `matched_journal_entry_id` set. Two things followed, and neither was visible to anyone:
      //   1. the JE posted under the OLD (wrong) account stayed in the ledger, unreversed; and
      //   2. bank-feed-gl-posting.service.ts:160 refuses to post a row that already carries
      //      `matched_journal_entry_id` (`already_posted`), so the CORRECTED categorization could
      //      never post either.
      // Net effect: re-categorising was a silent no-op against the general ledger. The operator saw
      // the correction, the books kept the error, and nothing surfaced the divergence — a
      // SILENT-SUCCESS defect, and for an auditor worse than a duplicate, because the operational
      // record and the ledger disagree permanently with no signal.
      //
      // Verified on prod 2026-08-03 (banking.bank_transactions 10975/10975 visible, n_tup_del 46):
      // ZERO rows were stranded, i.e. the trap had not yet been sprung. It is closed here before it is.
      //
      // FAIL-CLOSED. The reversal runs on this same transaction client, so if it throws — closed
      // period, non-posted JE, an integrity conflict — the whole undo rolls back and the caller gets
      // an error. Refusing the undo is correct: silently leaving a stale GL line is the outcome this
      // exists to prevent. Reuses the EXISTING reverseJournalEntryNoFlip (idempotent, linkage-aware);
      // NO new GL math is written here.
      const posted = await client.query<{ matched_journal_entry_id: string | null }>(
        `SELECT matched_journal_entry_id::text
           FROM banking.bank_transactions
          WHERE id = $1 AND operating_company_id = $2::uuid
          LIMIT 1
          FOR UPDATE`,
        [params.data.id, companyId]
      );
      const priorJournalEntryId = posted.rows[0]?.matched_journal_entry_id ?? null;

      // BANK-F03 — FAIL LOUD rather than reverse into a dead end.
      //
      // BANK-F01 (PR #4225) made this handler reverse the posted JE, which fixed a stale-ledger defect
      // but introduced a WORSE one that I did not catch before merging: the canonical poster cannot
      // RE-POST a source transaction after a reversal (its batch idempotency key ends in
      // posting_purpose, which has only initial_post|reversal — see POSTING_ENGINE_SUPPORTS_REPOST).
      // So the sequence became: reverse the entry, clear the link, then have the corrected
      // categorization silently return the ORIGINAL batch. Net effect: the expense disappears from the
      // books entirely. Proven on a prod fork — 20 rows, fuel down $4,593.94, target accounts zero lines.
      //
      // Until the poster gains a real repost capability, refusing is the only honest outcome: a wrong
      // account on the books is recoverable, an expense silently deleted from the ledger is not. This
      // check runs BEFORE the reversal, so nothing is undone when nothing can be re-posted.
      if (priorJournalEntryId && !POSTING_ENGINE_SUPPORTS_REPOST) {
        return {
          status: "repost_unsupported" as const,
          journalEntryId: priorJournalEntryId,
        };
      }

      if (priorJournalEntryId) {
        await reverseJournalEntryNoFlip(client, {
          operatingCompanyId: companyId,
          journalEntryId: priorJournalEntryId,
          reason: `undo-categorization of bank transaction ${params.data.id}`,
          actorUserId: user.uuid,
        });
      }

      // BANK-F9517: this used to .catch(() => ({ rows: [] })) — worse than the fake-empty-200 class
      // (BANK-F9514/15/16), because `if (!res.rows[0]) return false` below turns ANY query failure
      // (constraint violation, connection drop, a future column rename) into the exact same 404
      // "transaction_not_found" the caller gets for a genuinely missing row. A real error here — after
      // reverseJournalEntryNoFlip has already run above, on this SAME transaction client — MUST throw
      // so the whole undo (JE reversal included) rolls back; that is the entire point of the
      // "FAIL-CLOSED" design already documented on the reversal call a few lines up. Swallowing this
      // one query's failure quietly defeated that guarantee for exactly the step it existed to protect.
      const res = await client.query(
        `
          UPDATE banking.bank_transactions
          SET
            status = 'pending_categorization',
            -- Cleared with the reversal above: leaving it set is what made the corrected
            -- categorization unpostable (already_posted) while the wrong JE stood.
            matched_journal_entry_id = NULL,
            category = NULL,
            category_kind = NULL,
            linked_entity_id = NULL,
            categorization_customer_id = NULL,
            categorization_vendor_id = NULL,
            categorization_gl_account_id = NULL,
            categorization_project_id = NULL,
            categorization_memo = NULL,
            suggested_match_invoice_id = NULL,
            suggested_match_bill_id = NULL,
            destination_bank_account_id = NULL,
            transfer_kind = NULL,
            paired_transaction_id = NULL,
            skip_reason = NULL,
            investigate_note = NULL,
            categorized_at = NULL,
            updated_at = now()
          WHERE id = $1
            AND operating_company_id = $2::uuid
          RETURNING id
        `,
        [params.data.id, companyId]
      );
      if (!res.rows[0]) return false;
      await appendCrudAudit(
        client,
        user.uuid,
        "banking.transaction.reclassified",
        {
          resource_type: "banking.bank_transactions",
          resource_id: params.data.id,
          operating_company_id: companyId,
          // BANK-F01 — name the JE that was reversed. Without it the audit trail records that a
          // categorization was undone but not that the ledger was corrected, which is the half a
          // reviewer actually needs.
          reversed_journal_entry_id: priorJournalEntryId,
        },
        "info",
        "BT-3-BANKING-REBUILD"
      );
      return true;
    });
    if (ok && typeof ok === "object" && "status" in ok && ok.status === "repost_unsupported") {
      return reply.code(409).send({
        error: "repost_unsupported",
        message:
          "This transaction has a posted journal entry, and the posting engine cannot yet re-post a " +
          "corrected categorization after a reversal. Undoing now would reverse the entry and leave the " +
          "expense unrecorded. Refused deliberately (BANK-F03).",
        journal_entry_id: ok.journalEntryId,
      });
    }
    if (!ok) return reply.code(404).send({ error: "transaction_not_found" });
    return { ok: true };
  });

  // ── Cash-GL setup (B-1, fork-A: reuse banking.bank_accounts.ledger_account_id) ───────────────────────
  // Maps each bank account → its COA cash GL account, per entity. NO posting, NO flag — setup only.
  // GET returns the bank accounts + their current mapping + the entity's COA asset accounts to choose from.
  app.get("/api/v1/banking/accounts/cash-gl-mapping", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const query = z.object({ operating_company_id: z.string().uuid() }).safeParse(req.query ?? {});
    if (!query.success) return sendValidationError(reply, query.error);
    const companyId = query.data.operating_company_id;
    const payload = await withCompanyScope(user.uuid, companyId, async (client) => {
      const hideOn = await isBankAccountHideEnabled(client, companyId);
      const banks = await client.query<{ id: string; account_name: string; ledger_account_id: string | null; ledger_account_name: string | null; ledger_account_number: string | null }>(
        `SELECT ba.id::text, ba.account_name,
                ba.ledger_account_id::text,
                a.account_name AS ledger_account_name, a.account_number AS ledger_account_number
           FROM banking.bank_accounts ba
           LEFT JOIN catalogs.accounts a ON a.id = ba.ledger_account_id AND a.operating_company_id = ba.operating_company_id
          WHERE ba.operating_company_id = $1::uuid AND ba.deactivated_at IS NULL
          ${bankAccountHiddenFilterSql(hideOn, "ba")}
          ORDER BY ba.account_name ASC`,
        [companyId]
      );
      // Only postable asset leaves — binding a non-postable header/group account breaks bank→GL posting.
      const coa = await client.query<{ id: string; account_number: string; account_name: string }>(
        `SELECT id::text, account_number, account_name
           FROM catalogs.accounts
          WHERE operating_company_id = $1::uuid
            AND deactivated_at IS NULL
            AND account_type ILIKE 'asset'
            AND is_postable = true
          ORDER BY account_number ASC`,
        [companyId]
      );
      return { bank_accounts: banks.rows, coa_cash_accounts: coa.rows };
    });
    return payload;
  });

  // PUT sets a bank account's cash GL account. Owner/Administrator only. Cross-entity is rejected fail-loud:
  // the chosen COA account's operating_company_id MUST equal the bank account's (both already entity-scoped).
  app.put("/api/v1/banking/accounts/:id/cash-gl", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!["Owner", "Administrator"].includes(String((user as { role?: string }).role ?? ""))) {
      return reply.code(403).send({ error: "forbidden", detail: "cash-GL mapping is Owner/Administrator only" });
    }
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const query = z.object({ operating_company_id: z.string().uuid() }).safeParse(req.query ?? {});
    if (!query.success) return sendValidationError(reply, query.error);
    const body = z.object({ ledger_account_id: z.string().uuid().nullable() }).safeParse(req.body ?? {});
    if (!body.success) return sendValidationError(reply, body.error);
    const companyId = query.data.operating_company_id;

    const result = await withCompanyScope(user.uuid, companyId, async (client) => {
      const hideOn = await isBankAccountHideEnabled(client, companyId);
      const bank = await client.query<{ id: string }>(
        `SELECT id FROM banking.bank_accounts WHERE id = $1 AND operating_company_id = $2::uuid AND deactivated_at IS NULL ${bankAccountHiddenFilterSql(hideOn, "banking.bank_accounts")} LIMIT 1`,
        [params.data.id, companyId]
      );
      if (!bank.rows[0]) return { error: "bank_account_not_found" as const };
      // Cross-entity + postable guard: COA account must belong to THIS entity and be is_postable.
      if (body.data.ledger_account_id) {
        const acct = await client.query<{ id: string; is_postable: boolean }>(
          `SELECT id, is_postable
             FROM catalogs.accounts
            WHERE id = $1 AND operating_company_id = $2::uuid AND deactivated_at IS NULL
            LIMIT 1`,
          [body.data.ledger_account_id, companyId]
        );
        if (!acct.rows[0]) return { error: "account_not_in_entity" as const };
        if (acct.rows[0].is_postable !== true) return { error: "account_not_postable" as const };
      }
      await client.query(
        `UPDATE banking.bank_accounts SET ledger_account_id = $1, updated_at = now() WHERE id = $2 AND operating_company_id = $3::uuid`,
        [body.data.ledger_account_id, params.data.id, companyId]
      );
      await appendCrudAudit(
        client,
        user.uuid,
        "banking.bank_account.cash_gl_mapped",
        { resource_type: "banking.bank_accounts", resource_id: params.data.id, operating_company_id: companyId, ledger_account_id: body.data.ledger_account_id },
        "info",
        "B-1-CASH-GL-SETUP"
      );
      return { ok: true as const };
    });
    if ("error" in result) {
      const code = result.error === "bank_account_not_found" ? 404 : 400;
      return reply.code(code).send({ error: result.error });
    }
    return result;
  });

  // ── BANK-ACCOUNT-HIDE (Tier-1 HOLD, behind BANK_ACCOUNT_HIDE_ENABLED, default OFF) ──────────────────
  // Owner/Administrator only. Hide/unhide is a per-entity, reversible, audited visibility toggle — it
  // NEVER deletes the row (void-not-delete). See docs/accounting/BANK-ACCOUNT-ENTITY-HIDE-DESIGN.md.
  const hideBodySchema = z.object({
    operating_company_id: z.string().uuid(),
    reason: z.string().trim().min(1).max(500),
  });
  const unhideBodySchema = z.object({
    operating_company_id: z.string().uuid(),
  });

  app.post("/api/v1/banking/accounts/:id/hide", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!isBankAccountHideAdminRole(String((user as { role?: string }).role ?? ""))) {
      return reply.code(403).send({ error: "forbidden", detail: "bank-account hide is Owner/Administrator only" });
    }
    const params = accountIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const body = hideBodySchema.safeParse(req.body ?? {});
    if (!body.success) return sendValidationError(reply, body.error);
    const companyId = body.data.operating_company_id;

    const result = await withCompanyScope(user.uuid, companyId, async (client) => {
      const row = await hideBankAccountForEntity(client, {
        bankAccountId: params.data.id,
        operatingCompanyId: companyId,
        actorUserId: user.uuid,
        reason: body.data.reason,
      });
      return row;
    });
    if (!result) return reply.code(404).send({ error: "bank_account_not_found_or_already_hidden" });
    return { account: result };
  });

  app.post("/api/v1/banking/accounts/:id/unhide", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!isBankAccountHideAdminRole(String((user as { role?: string }).role ?? ""))) {
      return reply.code(403).send({ error: "forbidden", detail: "bank-account unhide is Owner/Administrator only" });
    }
    const params = accountIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const body = unhideBodySchema.safeParse(req.body ?? {});
    if (!body.success) return sendValidationError(reply, body.error);
    const companyId = body.data.operating_company_id;

    const result = await withCompanyScope(user.uuid, companyId, async (client) => {
      const row = await unhideBankAccountForEntity(client, {
        bankAccountId: params.data.id,
        operatingCompanyId: companyId,
        actorUserId: user.uuid,
      });
      return row;
    });
    if (!result) return reply.code(404).send({ error: "bank_account_not_found_or_not_hidden" });
    return { account: result };
  });
}
