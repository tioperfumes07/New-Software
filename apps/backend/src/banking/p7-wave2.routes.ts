import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { companyQuerySchema, currentAuthUser, validationError, withCompanyScope } from "../accounting/shared.js";
import { BankingRuleRow, PlaidCategoryRuleRow, mergeSuggestionPreferHigher, suggestionFromPlaidCategory, suggestionFromRules } from "./suggestion-engine.js";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
import { findCandidates, QBO_DAYS_AFTER, QBO_DAYS_BEFORE } from "../accounting/bank-recon/match.service.js";
import { bankTransactionHiddenFilterSql, isBankAccountHideEnabled } from "./bank-account-visibility.js";
import { supersedePlaidPendingByExactPostedCandidate } from "./bank-tx-dedup.js";
import { runDriftDetectors } from "./drift-alerts.service.js";

const financeRoles = new Set(["Owner", "Administrator", "Manager", "Accountant"]);

function financeUser(req: Parameters<typeof currentAuthUser>[0], reply: Parameters<typeof currentAuthUser>[1]) {
  const user = currentAuthUser(req, reply);
  if (!user) return null;
  if (!financeRoles.has(String(user.role))) {
    reply.code(403).send({ error: "forbidden" });
    return null;
  }
  return user as { uuid: string; role: string };
}

export async function registerBankingP7Wave2Routes(app: FastifyInstance) {
  const reviewQuery = companyQuerySchema.extend({
    state: z.enum(["for_review", "categorized", "excluded", "matched", "transfer"]).optional(),
    account_id: z.string().uuid().optional(),
    date_start: z.string().optional(),
    date_end: z.string().optional(),
    search: z.string().optional(),
    cursor: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  });

  app.post("/api/v1/banking/transactions/:id/supersede-plaid-pending", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = financeUser(req, reply);
    if (!user) return;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const body = companyQuerySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);

    const result = await withCompanyScope(user.uuid, body.data.operating_company_id, async (client) => {
      const superseded = await supersedePlaidPendingByExactPostedCandidate(client, {
        pendingRowId: params.data.id,
        operatingCompanyId: body.data.operating_company_id,
      });
      if (superseded.superseded) {
        await appendCrudAudit(client, user.uuid, "banking.plaid_pending_superseded", {
          operating_company_id: body.data.operating_company_id,
          pending_transaction_id: superseded.pending_id,
          posted_transaction_id: superseded.posted_id,
        }, "warning", "BANK-F10151");
      }
      return superseded;
    });

    if (!result.superseded) {
      const status = result.reason === "pending_not_found" ? 404 : 409;
      return reply.code(status).send({ error: result.reason });
    }
    return { ok: true, pending_transaction_id: result.pending_id, posted_transaction_id: result.posted_id };
  });

  app.get("/api/v1/banking/transactions/review", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = financeUser(req, reply);
    if (!user) return;

    const parsed = reviewQuery.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const q = parsed.data;

    const rows = await withCompanyScope(user.uuid, q.operating_company_id, async (client) => {
      await appendCrudAudit(client, user.uuid, "banking.txn_review_list", { operating_company_id: q.operating_company_id }, "info", "P7-W2-BANK");

      const rulesRes = await client.query(
        `SELECT priority, description_contains, description_regex, amount_min_cents, amount_max_cents,
                bank_account_filter_id, then_vendor_id, then_account_id, then_class_id
         FROM accounting.banking_rules
         WHERE operating_company_id = $1::uuid AND is_active = true`,
        [q.operating_company_id]
      );
      const rules = rulesRes.rows as BankingRuleRow[];

      // BANK-F25011 — the owner-curated Plaid-category → COA mapping (banking.transaction_categories).
      // Loaded once here so every review row can surface the SAME account autoCategorize would pick,
      // via the shared scoreRuleMatch scorer. Suggestion only; Accept is what categorizes/posts.
      const categoryRulesRes = await client.query(
        `SELECT plaid_category_pattern, description_pattern, coa_account_id, priority
         FROM banking.transaction_categories
         WHERE operating_company_id = $1::uuid AND is_active = true
         ORDER BY priority ASC, created_at ASC`,
        [q.operating_company_id]
      );
      const categoryRules = categoryRulesRes.rows as PlaidCategoryRuleRow[];

      // BANK-ACCOUNT-HIDE: the review/categorization worklist must never surface a transaction on an
      // account hidden for THIS entity (flag OFF by default — see
      // docs/accounting/BANK-ACCOUNT-ENTITY-HIDE-DESIGN.md).
      const hideOn = await isBankAccountHideEnabled(client, q.operating_company_id);
      const params: unknown[] = [q.operating_company_id];
      let where = `bt.operating_company_id = $1::uuid ${bankTransactionHiddenFilterSql(hideOn, "bt")}`;
      if (q.state) {
        params.push(q.state);
        where += ` AND bt.review_state = $${params.length}`;
      }
      if (q.account_id) {
        params.push(q.account_id);
        where += ` AND bt.bank_account_id = $${params.length}`;
      }
      if (q.date_start) {
        params.push(q.date_start);
        where += ` AND bt.transaction_date >= $${params.length}::date`;
      }
      if (q.date_end) {
        params.push(q.date_end);
        where += ` AND bt.transaction_date <= $${params.length}::date`;
      }
      if (q.search?.trim()) {
        params.push(`%${q.search.trim()}%`);
        where += ` AND (bt.description ILIKE $${params.length} OR bt.merchant_name ILIKE $${params.length})`;
      }
      params.push(q.limit);
      params.push(q.cursor ?? 0);
      const lim = params.length - 1;
      const off = params.length;
      const res = await client.query(
        `
          SELECT bt.*, ba.account_name AS bank_account_name
          FROM banking.bank_transactions bt
          JOIN banking.bank_accounts ba ON ba.id = bt.bank_account_id
          WHERE ${where}
          ORDER BY bt.transaction_date DESC, bt.id DESC
          LIMIT $${lim} OFFSET $${off}
        `,
        params
      );
      return res.rows.map((row: Record<string, unknown>) => {
        const sug =
          mergeSuggestionPreferHigher(
            suggestionFromRules(rules, {
              description_normalized: row.description_normalized as string | null,
              description: row.description as string | null,
              amount_cents: Number(row.amount_cents),
              bank_account_id: String(row.bank_account_id),
            }),
            null
          ) ?? null;
        const plaid = suggestionFromPlaidCategory(
          categoryRules,
          Array.isArray(row.plaid_category) ? (row.plaid_category as string[]) : [],
          (row.description as string | null) ?? null
        );
        const merged =
          plaid && sug
            ? mergeSuggestionPreferHigher(sug, {
                vendor_id: null,
                account_id: plaid.account_id,
                class_id: null,
                confidence: plaid.confidence,
                source: plaid.source,
              })
            : sug ??
              (plaid
                ? {
                    vendor_id: null,
                    account_id: plaid.account_id,
                    class_id: null,
                    confidence: plaid.confidence,
                    source: plaid.source,
                  }
                : null);

        return {
          ...row,
          suggestion: merged,
          match_candidates_count: 0,
        };
      });
    });

    return { items: rows, next_cursor: (q.cursor ?? 0) + rows.length };
  });

  // Ranked match candidates for a single bank transaction. Replaces the Wave-2 stub that returned
  // match_candidates_count:0. Read-only (Part 1): returns the scored/ranked ledger candidates (open
  // bills + expenses + bill_payments + transfers + payments/AR + JEs, direction-aware). The
  // operating_company_id is taken from the validated query + membership guard (server-side active
  // entity), NEVER trusted from a client body. findCandidates may auto-store a single high-confidence
  // match into banking.reconciliation_matches — that write pre-exists, is additive, and posts NO GL, so
  // this endpoint stays Tier-3.
  app.get("/api/v1/banking/transactions/:id/match-candidates", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = financeUser(req, reply);
    if (!user) return;

    const params = z.object({ id: z.string().uuid() }).safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const parsed = companyQuerySchema
      .extend({
        window_days: z.coerce.number().int().min(1).max(730).optional(),
        q: z.string().max(200).optional(),
        search_all: z
          .union([z.literal("1"), z.literal("true"), z.literal("yes")])
          .optional()
          .transform((v) => Boolean(v)),
        // BANK-MATCH-QBO (owner 2026-09-06): the QuickBooks "Find match" filters — Show (kinds, csv),
        // Payee, date From/To, amount From/To (dollars, as typed).
        kinds: z
          .string()
          .max(120)
          .optional()
          .transform((v) => (v ? v.split(",").map((k) => k.trim()).filter(Boolean) : undefined))
          .pipe(z.array(z.enum(["payment", "bill_payment", "transfer", "je", "bill", "expense"])).optional()),
        payee: z.string().max(200).optional(),
        date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        amount_min: z.coerce.number().min(0).optional(),
        amount_max: z.coerce.number().min(0).optional(),
      })
      .safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const operatingCompanyId = parsed.data.operating_company_id;

    // Membership guard: a user may only pull candidates for an entity they belong to.
    await assertCompanyMembership(user.uuid, operatingCompanyId);

    const windowDays = parsed.data.search_all ? parsed.data.window_days ?? 365 : parsed.data.window_days;
    const candidates = await findCandidates({
      operating_company_id: operatingCompanyId,
      bank_transaction_id: params.data.id,
      actor_user_uuid: user.uuid,
      window_days: windowDays,
      search_query: parsed.data.q,
      kinds: parsed.data.kinds,
      payee: parsed.data.payee,
      date_from: parsed.data.date_from,
      date_to: parsed.data.date_to,
      amount_min_cents: parsed.data.amount_min == null ? undefined : Math.round(parsed.data.amount_min * 100),
      amount_max_cents: parsed.data.amount_max == null ? undefined : Math.round(parsed.data.amount_max * 100),
    });

    // LINK-F5190: the response never echoed which bank_transaction_id these candidates are FOR --
    // callers (MatchDrawer.tsx) had to rely entirely on the id they already threaded in as a prop,
    // with no authoritative confirmation from the response itself. Small, real completeness fix.
    return {
      candidates,
      match_candidates_count: candidates.length,
      // QuickBooks default: 90 days before / 20 after the bank date when no window is given.
      window_days: windowDays ?? null,
      days_before: windowDays ?? QBO_DAYS_BEFORE,
      days_after: windowDays ?? QBO_DAYS_AFTER,
      search_query: parsed.data.q ?? null,
      filters: {
        kinds: parsed.data.kinds ?? null,
        payee: parsed.data.payee ?? null,
        date_from: parsed.data.date_from ?? null,
        date_to: parsed.data.date_to ?? null,
        amount_min: parsed.data.amount_min ?? null,
        amount_max: parsed.data.amount_max ?? null,
      },
      bank_transaction_id: params.data.id,
    };
  });

  // B.1 (owner order 2026-09-05, CODER-SEQUENCE-NUMBERED-2026-09-05.md CC-2 §6): a bulk version of
  // match-candidates above so the transactions LIST can show a "suggested match" per row without
  // opening the drawer for each one — same underlying findCandidates (zero new matching math),
  // filtered to the narrower "exact cents, within AUTO_MATCH_DATE_WINDOW_DAYS (5), against an
  // expense or bill" shape the owner specifically named. Read-only: this endpoint writes NOTHING —
  // findCandidates already owns the one narrow, pre-existing auto-persist path (a MATCH LINK, never
  // a GL post) for its own auto_match-quality case; this bulk wrapper does not add a second one.
  // "Accept -> match never auto-post" holds because accepting a suggestion here reuses the existing
  // accept-match flow (acceptMatchWithResolveDifference) unchanged — no new write path.
  const suggestBodySchema = z.object({
    operating_company_id: z.string().uuid(),
    bank_transaction_ids: z.array(z.string().uuid()).min(1).max(200),
  });
  app.post("/api/v1/banking/transactions/suggest", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = financeUser(req, reply);
    if (!user) return;

    const body = suggestBodySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);
    const operatingCompanyId = body.data.operating_company_id;
    await assertCompanyMembership(user.uuid, operatingCompanyId);

    const results = await Promise.all(
      body.data.bank_transaction_ids.map(async (bankTransactionId) => {
        const candidates = await findCandidates({
          operating_company_id: operatingCompanyId,
          bank_transaction_id: bankTransactionId,
          actor_user_uuid: user.uuid,
        });
        // "suggest exact cents +-5d to expenses/bills" — literal filter, narrower than the general
        // auto_match flag (which also requires memo_similarity >= 0.8): amount_gap_cents === 0 and
        // date_gap_days <= AUTO_MATCH_DATE_WINDOW_DAYS (5), kind in {expense, bill} only.
        const best = candidates.find(
          (c) => c.exact_amount && c.date_gap_days <= 5 && (c.ledger_entry_kind === "expense" || c.ledger_entry_kind === "bill")
        );
        if (!best) return { bank_transaction_id: bankTransactionId, suggestion: null };
        return {
          bank_transaction_id: bankTransactionId,
          suggestion: {
            suggested_ledger_entry_kind: best.ledger_entry_kind,
            suggested_ledger_entry_id: best.ledger_entry_id,
            // "suggested_* + confidence" — high when the SAME candidate already clears the full
            // auto_match bar (adds memo_similarity >= 0.8), medium when only amount+date qualify.
            suggested_confidence: best.auto_match ? "high" : "medium",
            date_gap_days: best.date_gap_days,
            memo_similarity: best.memo_similarity,
          },
        };
      })
    );

    return {
      suggestions: Object.fromEntries(results.map((r) => [r.bank_transaction_id, r.suggestion])),
    };
  });

  app.get("/api/v1/banking/rules", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = financeUser(req, reply);
    if (!user) return;
    const parsed = companyQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);

    const rows = await withCompanyScope(user.uuid, parsed.data.operating_company_id, async (client) => {
      const res = await client.query(`SELECT * FROM accounting.banking_rules WHERE operating_company_id = $1::uuid ORDER BY priority DESC`, [
        parsed.data.operating_company_id,
      ]);
      return res.rows;
    });
    return { items: rows };
  });

  app.post("/api/v1/banking/rules", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = financeUser(req, reply);
    if (!user) return;

    const body = z
      .object({
        operating_company_id: z.string().uuid(),
        priority: z.coerce.number().int().optional().default(0),
        description_contains: z.string().optional(),
        description_regex: z.string().optional(),
        amount_min_cents: z.coerce.number().int().optional(),
        amount_max_cents: z.coerce.number().int().optional(),
        bank_account_filter_id: z.string().uuid().optional(),
        then_vendor_id: z.string().uuid().optional(),
        then_account_id: z.string().uuid(),
        then_class_id: z.string().uuid().optional(),
        then_memo_template: z.string().optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);

    const id = await withCompanyScope(user.uuid, body.data.operating_company_id, async (client) => {
      const acct = await client.query(`SELECT id FROM catalogs.accounts WHERE id = $1 AND operating_company_id = $2::uuid LIMIT 1`, [body.data.then_account_id, body.data.operating_company_id]);
      if (!acct.rows[0]) {
        reply.code(400).send({ error: "unknown_account" });
        return null;
      }
      const ins = await client.query(
        `
          INSERT INTO accounting.banking_rules (
            operating_company_id, priority, description_contains, description_regex,
            amount_min_cents, amount_max_cents, bank_account_filter_id,
            then_vendor_id, then_account_id, then_class_id, then_memo_template,
            created_by_user_id
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::uuid)
          RETURNING id
        `,
        [
          body.data.operating_company_id,
          body.data.priority,
          body.data.description_contains ?? null,
          body.data.description_regex ?? null,
          body.data.amount_min_cents ?? null,
          body.data.amount_max_cents ?? null,
          body.data.bank_account_filter_id ?? null,
          body.data.then_vendor_id ?? null,
          body.data.then_account_id,
          body.data.then_class_id ?? null,
          body.data.then_memo_template ?? null,
          user.uuid,
        ]
      );
      const newId = (ins.rows[0] as { id?: string } | undefined)?.id;
      await appendCrudAudit(client, user.uuid, "banking.rule_created", { id: newId }, "info", "P7-W2-BANK");
      return newId ?? null;
    });
    if (!id) return;
    return reply.code(201).send({ id });
  });

  app.patch("/api/v1/banking/rules/:id", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = financeUser(req, reply);
    if (!user) return;

    const params = z.object({ id: z.string().uuid() }).safeParse(req.params ?? {});
    const body = z
      .object({
        operating_company_id: z.string().uuid(),
        priority: z.coerce.number().int().optional(),
        is_active: z.boolean().optional(),
      })
      .safeParse(req.body ?? {});
    if (!params.success || !body.success) return validationError(reply, params.success ? body.error! : params.error);

    const updated = await withCompanyScope(user.uuid, body.data.operating_company_id, async (client) => {
      // GO-0022-BANK-P7-W2-FAKE-SUCCESS: no RETURNING/rowCount check at all — a nonexistent or
      // cross-company rule id silently matched 0 rows, yet the route still wrote a
      // banking.rule_updated audit entry and returned { ok: true }.
      const res = await client.query(
        `
          UPDATE accounting.banking_rules
          SET
            priority = COALESCE($3, priority),
            is_active = COALESCE($4, is_active),
            updated_at = now()
          WHERE id = $1 AND operating_company_id = $2::uuid
          RETURNING id
        `,
        [params.data.id, body.data.operating_company_id, body.data.priority ?? null, body.data.is_active ?? null]
      );
      if (res.rows.length === 0) return false;
      await appendCrudAudit(client, user.uuid, "banking.rule_updated", { id: params.data.id }, "info", "P7-W2-BANK");
      return true;
    });
    if (!updated) return reply.code(404).send({ error: "banking_rule_not_found" });
    return { ok: true };
  });

  app.delete("/api/v1/banking/rules/:id", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = financeUser(req, reply);
    if (!user) return;

    const params = z.object({ id: z.string().uuid() }).safeParse(req.params ?? {});
    const q = companyQuerySchema.safeParse(req.query ?? {});
    if (!params.success || !q.success) return reply.code(400).send({ error: "validation_error" });

    const deactivated = await withCompanyScope(user.uuid, q.data.operating_company_id, async (client) => {
      // INV-2: void-never-delete — deactivate, never hard-delete banking rule config.
      // GO-0022-BANK-P7-W2-FAKE-SUCCESS: same missing rowCount check as PATCH above.
      const res = await client.query(
        `UPDATE accounting.banking_rules SET is_active = false, updated_at = now() WHERE id = $1 AND operating_company_id = $2::uuid RETURNING id`,
        [params.data.id, q.data.operating_company_id]
      );
      if (res.rows.length === 0) return false;
      await appendCrudAudit(client, user.uuid, "banking.rule_deleted", { id: params.data.id }, "warning", "P7-W2-BANK");
      return true;
    });
    if (!deactivated) return reply.code(404).send({ error: "banking_rule_not_found" });
    return { ok: true };
  });

  app.post("/api/v1/banking/transactions/:id/refresh-suggestion", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = financeUser(req, reply);
    if (!user) return;

    const params = z.object({ id: z.string().uuid() }).safeParse(req.params ?? {});
    const body = z.object({ operating_company_id: z.string().uuid() }).safeParse(req.body ?? {});
    if (!params.success || !body.success) return reply.code(400).send({ error: "validation_error" });

    await withCompanyScope(user.uuid, body.data.operating_company_id, async (client) => {
      const txn = await client.query(`SELECT * FROM banking.bank_transactions WHERE id = $1`, [params.data.id]);
      const row = txn.rows[0];
      if (!row || String(row.operating_company_id) !== body.data.operating_company_id) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      const rulesRes = await client.query(
        `SELECT priority, description_contains, description_regex, amount_min_cents, amount_max_cents,
                bank_account_filter_id, then_vendor_id, then_account_id, then_class_id
         FROM accounting.banking_rules
         WHERE operating_company_id = $1::uuid AND is_active = true`,
        [body.data.operating_company_id]
      );
      const sug = suggestionFromRules(rulesRes.rows as BankingRuleRow[], {
        description_normalized: row.description_normalized as string | null,
              description: row.description as string | null,
        amount_cents: Number(row.amount_cents),
        bank_account_id: String(row.bank_account_id),
      });
      await client.query(
        `
          UPDATE banking.bank_transactions
          SET
            suggested_vendor_id = $2::uuid,
            suggested_account_id = $3::uuid,
            suggested_confidence = $4,
            suggested_source = $5,
            suggested_at = now(),
            updated_at = now()
          WHERE id = $1
        `,
        [
          params.data.id,
          sug?.vendor_id ?? null,
          sug?.account_id ?? null,
          sug?.confidence ?? null,
          sug?.source ?? null,
        ]
      );
      await appendCrudAudit(client, user.uuid, "banking.txn_suggestion_refreshed", { transaction_id: params.data.id }, "info", "P7-W2-BANK");
    });
    if (reply.sent) return;
    return { ok: true };
  });

  app.post("/api/v1/banking/reconciliation-sessions", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = financeUser(req, reply);
    if (!user) return;

    const body = z
      .object({
        operating_company_id: z.string().uuid(),
        account_id: z.string().uuid(),
        period_start: z.string(),
        period_end: z.string(),
        statement_balance_cents: z.coerce.number().int(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);

    const row = await withCompanyScope(user.uuid, body.data.operating_company_id, async (client) => {
      const ins = await client.query(
        `
          INSERT INTO banking.reconciliation_sessions (
            operating_company_id, bank_account_id, period_start, period_end,
            statement_balance_cents, book_balance_cents, variance_cents, status
          )
          VALUES (
            $1::uuid, $2::uuid, $3::date, $4::date,
            $5::bigint, 0::bigint,
            ($5::bigint - 0::bigint), 'open'
          )
          RETURNING id
        `,
        [
          body.data.operating_company_id,
          body.data.account_id,
          body.data.period_start,
          body.data.period_end,
          body.data.statement_balance_cents,
        ]
      );
      const sid = (ins.rows[0] as { id?: string } | undefined)?.id;
      await appendCrudAudit(client, user.uuid, "banking.reconciliation_session_created", { id: sid }, "info", "P7-W2-BANK");
      return sid ? { id: sid } : undefined;
    });

    return reply.code(201).send({ id: row?.id });
  });

  app.get("/api/v1/banking/reconciliation-sessions", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = financeUser(req, reply);
    if (!user) return;
    const q = companyQuerySchema.extend({ account_id: z.string().uuid().optional() }).safeParse(req.query ?? {});
    if (!q.success) return validationError(reply, q.error);

    const rows = await withCompanyScope(user.uuid, q.data.operating_company_id, async (client) => {
      const params: unknown[] = [q.data.operating_company_id];
      let where = `operating_company_id = $1::uuid`;
      if (q.data.account_id) {
        params.push(q.data.account_id);
        where += ` AND bank_account_id = $${params.length}`;
      }
      const res = await client.query(`SELECT * FROM banking.reconciliation_sessions WHERE ${where} ORDER BY period_end DESC LIMIT 100`, params);
      return res.rows;
    });
    return { items: rows };
  });

  app.get("/api/v1/banking/reconciliation-sessions/:id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = financeUser(req, reply);
    if (!user) return;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params ?? {});
    const q = companyQuerySchema.safeParse(req.query ?? {});
    if (!params.success || !q.success) return reply.code(400).send({ error: "validation_error" });

    const payload = await withCompanyScope(user.uuid, q.data.operating_company_id, async (client) => {
      const ses = await client.query(`SELECT * FROM banking.reconciliation_sessions WHERE id = $1 AND operating_company_id = $2::uuid`, [
        params.data.id,
        q.data.operating_company_id,
      ]);
      const session = ses.rows[0];
      if (!session) return null;
      const txns = await client.query(
        `
          SELECT *
          FROM banking.bank_transactions
          WHERE operating_company_id = $1::uuid
            AND reconciliation_session_id = $2::uuid
          ORDER BY transaction_date DESC
        `,
        [q.data.operating_company_id, params.data.id]
      );
      return { session, matched_transactions: txns.rows };
    });
    if (!payload) return reply.code(404).send({ error: "not_found" });
    return payload;
  });

  app.post("/api/v1/banking/reconciliation-sessions/:id/finalize", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = financeUser(req, reply);
    if (!user) return;

    const params = z.object({ id: z.string().uuid() }).safeParse(req.params ?? {});
    const body = z.object({ operating_company_id: z.string().uuid() }).safeParse(req.body ?? {});
    if (!params.success || !body.success) return reply.code(400).send({ error: "validation_error" });

    await withCompanyScope(user.uuid, body.data.operating_company_id, async (client) => {
      const ses = await client.query(
        `SELECT variance_cents::text FROM banking.reconciliation_sessions WHERE id = $1 AND operating_company_id = $2::uuid`,
        [params.data.id, body.data.operating_company_id]
      );
      // GO-0022-BANK-P7-W2-FAKE-SUCCESS: this used to `?? 0` a missing row straight into "variance is
      // $0, safe to finalize" — a nonexistent or cross-company session id silently passed the variance
      // check, then the UPDATE below matched 0 rows (also unchecked), yet the route still wrote a
      // banking.reconciliation_finalized audit entry and returned { ok: true }: a fabricated success
      // AND a false audit-trail entry for a session that was never touched.
      const sessionRow = ses.rows[0] as { variance_cents?: string } | undefined;
      if (!sessionRow) {
        reply.code(404).send({ error: "reconciliation_session_not_found" });
        return;
      }
      const variance = Number(sessionRow.variance_cents ?? 0);
      if (variance !== 0) {
        reply.code(409).send({ error: "variance_nonzero", variance_cents: variance });
        return;
      }
      const updateRes = await client.query(
        `
          UPDATE banking.reconciliation_sessions
          SET status = 'finalized',
              finalized_at = now(),
              reconciled_at = COALESCE(reconciled_at, now()),
              reconciled_by_user_id = $3::uuid
          WHERE id = $1 AND operating_company_id = $2::uuid
          RETURNING id
        `,
        [params.data.id, body.data.operating_company_id, user.uuid]
      );
      if (updateRes.rows.length === 0) {
        reply.code(404).send({ error: "reconciliation_session_not_found" });
        return;
      }
      await appendCrudAudit(client, user.uuid, "banking.reconciliation_finalized", { id: params.data.id }, "info", "P7-W2-BANK");
      // GO-20 slice A — "A detector that runs after every reconciliation finalize and once
      // nightly." Never posts a journal entry; only reads sessions/balances and writes drift-alert
      // rows in the same scoped client/transaction as the finalize itself.
      await runDriftDetectors(client, body.data.operating_company_id);
    });
    if (reply.sent) return;
    return { ok: true };
  });
}
