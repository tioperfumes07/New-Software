import crypto from "node:crypto";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { withCurrentUser, withLuciaBypass } from "../auth/db.js";
import { enqueueSyncJob } from "../integrations/qbo/qbo-sync.service.js";
import { bankAccountHiddenFilterSql, isBankAccountHideEnabled } from "./bank-account-visibility.js";
import { isEnabled } from "../lib/feature-flags/service.js";
import { postSourceTransaction, reversePostedSourceTransaction, PostingEngineError } from "../accounting/posting-engine.service.js";

// BANKING-GL-COMPLETION — per-entity kill switch (default OFF; migration 202607150000). Resolved
// PER-ENTITY via isEnabled inside the request flow — never a global process.env read — so flipping it
// for one entity can never post transfers for every entity (constitution §1.4 money-posting discipline).
const TRANSFER_GL_POSTING_FLAG_KEY = "TRANSFER_GL_POSTING_ENABLED";

/**
 * Best-effort GL post for a just-committed transfer row. The transfer + cached-balance bump are ALREADY
 * committed by the caller (its own withCurrentUser transaction) before this runs, so a posting failure
 * here NEVER rolls back the transfer — it is logged and surfaced via the return value; the posting-engine
 * backfill (or a retry once the flag flips) can pick it up later. Reuses the shared posting engine
 * end-to-end (idempotency key + transaction_source_links spine) — no new GL math.
 */
async function maybePostTransferGl(
  operatingCompanyId: string,
  transferId: string,
  userId: string,
  purpose: "initial_post" | "reversal"
): Promise<void> {
  try {
    const postingEnabled = await withCurrentUser(userId, async (client) => {
      // RLS on lib.feature_flag_overrides requires app.operating_company_id to match the row's
      // operating_company_id. withCurrentUser alone does not set it — set it explicitly so that
      // company-level flag overrides are visible on this connection.
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
      return isEnabled(client, TRANSFER_GL_POSTING_FLAG_KEY, { operating_company_id: operatingCompanyId, user_uuid: userId });
    });
    if (!postingEnabled) return;

    if (purpose === "initial_post") {
      await postSourceTransaction(
        { operating_company_id: operatingCompanyId, source_transaction_type: "transfer", source_transaction_id: transferId },
        { userId }
      );
    } else {
      await reversePostedSourceTransaction(
        { operating_company_id: operatingCompanyId, source_transaction_type: "transfer", source_transaction_id: transferId },
        { userId }
      );
    }
  } catch (err) {
    if (err instanceof PostingEngineError && err.code === "SOURCE_NOT_FOUND" && purpose === "reversal") {
      // Nothing was ever posted for this transfer (flag was off when it was created) — nothing to reverse.
      return;
    }
    console.error(
      `[transfers] TRANSFER_GL_POSTING ${purpose} failed for transfer ${transferId} (row already committed)`,
      err
    );
  }
}

export type AccountKind = "bank" | "cc" | "coa";
export type TransferType = "bank_to_bank" | "cc_payment" | "cash_deposit" | "owner_contribution" | "owner_distribution" | "petty_cash_funding";

export type TransferInput = {
  operatingCompanyId: string;
  transferType: TransferType;
  fromAccountId: string;
  fromAccountKind: AccountKind;
  toAccountId: string;
  toAccountKind: AccountKind;
  amountCents: number;
  transferDate: string;
  memo?: string;
  referenceNumber?: string;
};

type TransferRow = {
  id: string;
  operating_company_id: string;
  from_account_id: string;
  from_account_kind: AccountKind;
  to_account_id: string;
  to_account_kind: AccountKind;
  amount_cents: number;
  revoked_at: string | null;
};

function payloadHash(input: Record<string, unknown>) {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

async function validateAccountOwnership(
  client: { query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[] }> },
  operatingCompanyId: string,
  accountId: string,
  accountKind: AccountKind
) {
  if (accountKind === "bank") {
    // BANK-ACCOUNT-HIDE: an account hidden for THIS entity can never be chosen as a NEW transfer
    // leg (flag OFF by default — see docs/accounting/BANK-ACCOUNT-ENTITY-HIDE-DESIGN.md).
    const hideOn = await isBankAccountHideEnabled(client, operatingCompanyId);
    const res = await client.query<{ id: string }>(
      `
        SELECT id
        FROM banking.bank_accounts
        WHERE id = $1
          AND operating_company_id = $2::uuid
          AND is_active = true
          ${bankAccountHiddenFilterSql(hideOn, "banking.bank_accounts")}
        LIMIT 1
      `,
      [accountId, operatingCompanyId]
    );
    return Boolean(res.rows[0]?.id);
  }
  const res = await client.query<{ id: string }>(
    `
      SELECT id
      FROM catalogs.accounts
      WHERE id = $1
        AND operating_company_id = $2::uuid
        AND deactivated_at IS NULL
      LIMIT 1
    `,
    [accountId, operatingCompanyId]
  );
  return Boolean(res.rows[0]?.id);
}

async function updateBankBalance(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }> },
  accountId: string,
  operatingCompanyId: string,
  deltaCents: number
) {
  const res = await client.query(
    `
      UPDATE banking.bank_accounts
      SET current_balance_cents = current_balance_cents + $3,
          updated_at = now()
      WHERE id = $1
        AND operating_company_id = $2::uuid
      RETURNING id
    `,
    [accountId, operatingCompanyId, deltaCents]
  );
  // BANK-TRANSFER-BALANCE-DUAL-WRITER-CONFLICT (GO-0027, CC-1): the account can be deactivated
  // between an earlier validateAccountOwnership check and this call (revokeTransfer's path does
  // not even re-validate first) — without this check the balance adjustment silently no-ops
  // while the transfer itself is still recorded as successful.
  if ((res.rowCount ?? 0) === 0) {
    throw new Error("bank_balance_update_zero_rows");
  }
}

type DbClient = {
  query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }>;
};

/** Insert + balance bump + audit on an existing client/txn. Caller commits, then may call maybePostTransferGl. */
export async function insertTransferInClient(client: DbClient, input: TransferInput, userId: string): Promise<TransferRow> {
  const fromOwned = await validateAccountOwnership(client, input.operatingCompanyId, input.fromAccountId, input.fromAccountKind);
  const toOwned = await validateAccountOwnership(client, input.operatingCompanyId, input.toAccountId, input.toAccountKind);
  if (!fromOwned || !toOwned) throw new Error("transfer_account_not_accessible");

  const insertRes = await client.query<TransferRow>(
    `
      INSERT INTO banking.transfers (
        operating_company_id,
        transfer_type,
        from_account_id,
        from_account_kind,
        to_account_id,
        to_account_kind,
        amount_cents,
        transfer_date,
        memo,
        reference_number,
        created_by_user_id,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now())
      RETURNING id, operating_company_id, from_account_id, from_account_kind, to_account_id, to_account_kind, amount_cents, revoked_at
    `,
    [
      input.operatingCompanyId,
      input.transferType,
      input.fromAccountId,
      input.fromAccountKind,
      input.toAccountId,
      input.toAccountKind,
      input.amountCents,
      input.transferDate,
      input.memo ?? null,
      input.referenceNumber ?? null,
      userId,
    ]
  );
  if ((insertRes.rowCount ?? 0) === 0 || !insertRes.rows[0]) {
    throw new Error("transfer_insert_failed");
  }
  const created = insertRes.rows[0];

  if (input.fromAccountKind === "bank") {
    await updateBankBalance(client, input.fromAccountId, input.operatingCompanyId, -Math.abs(input.amountCents));
  }
  if (input.toAccountKind === "bank") {
    await updateBankBalance(client, input.toAccountId, input.operatingCompanyId, Math.abs(input.amountCents));
  }

  await appendCrudAudit(
    client,
    userId,
    "banking.transfer.created",
    {
      resource_type: "banking.transfers",
      resource_id: created.id,
      operating_company_id: input.operatingCompanyId,
      transfer_type: input.transferType,
      from_account_id: input.fromAccountId,
      to_account_id: input.toAccountId,
      amount_cents: input.amountCents,
    },
    "info",
    "P5-D1-TRANSFER"
  );
  return created;
}

export async function createTransfer(input: TransferInput, userId: string) {
  if (input.amountCents <= 0) throw new Error("transfer_amount_must_be_positive");
  if (input.fromAccountId === input.toAccountId && input.fromAccountKind === input.toAccountKind) {
    throw new Error("self_transfer_not_allowed");
  }

  const transfer = await withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [input.operatingCompanyId]);
    return insertTransferInClient(client, input, userId);
  });

  // BANKING-GL-COMPLETION — post the balanced JE AFTER the transfer row is committed (postSourceTransaction
  // opens its OWN transaction; calling it inside the insert txn would self-deadlock). No-ops when
  // TRANSFER_GL_POSTING_ENABLED resolves false for this entity (the default).
  await maybePostTransferGl(transfer.operating_company_id, transfer.id, userId, "initial_post");

  await enqueueSyncJob(
    transfer.operating_company_id,
    "transfer",
    transfer.id,
    payloadHash({
      transfer_id: transfer.id,
      transfer_type: input.transferType,
      amount_cents: input.amountCents,
      transfer_date: input.transferDate,
    }),
    userId
  );

  return transfer;
}

type MarkBankFeedTransferInput = {
  operatingCompanyId: string;
  bankTransactionId: string;
  destinationBankAccountId: string;
  transferKind: "in" | "out";
  pairedTransactionId?: string | null;
  /** When the caller (RecordTransferModal/TransferModal) already minted the transfer via createTransfer,
   *  pass its id here so this call ONLY stamps the linkage — it must never mint a SECOND banking.transfers
   *  row for the same cash movement (that would double the balance bump + double-count the GL). */
  existingTransferId?: string | null;
  userId: string;
};

type BankFeedTransactionRow = {
  id: string;
  operating_company_id: string;
  bank_account_id: string | null;
  amount_cents: string | number | null;
  transaction_date: string;
  categorization_memo: string | null;
  description: string | null;
  matched_transfer_id: string | null;
};

async function loadBankTransactionForTransfer(
  client: DbClient,
  bankTransactionId: string,
  operatingCompanyId: string,
  opts?: { forUpdate?: boolean }
) {
  const forUpdate = opts?.forUpdate ? " FOR UPDATE" : "";
  const res = await client.query<BankFeedTransactionRow>(
    `
      SELECT id, operating_company_id, bank_account_id, amount_cents, transaction_date::text AS transaction_date,
             categorization_memo, description, matched_transfer_id::text AS matched_transfer_id
      FROM banking.bank_transactions
      WHERE id = $1
        AND operating_company_id = $2::uuid
      LIMIT 1${forUpdate}
    `,
    [bankTransactionId, operatingCompanyId]
  );
  return res.rows[0] ?? null;
}

async function stampBankTransactionTransferLink(
  client: DbClient,
  input: {
    bankTransactionId: string;
    operatingCompanyId: string;
    transferId: string;
    destinationBankAccountId: string;
    transferKind: "in" | "out";
    pairedTransactionId: string | null;
  }
): Promise<boolean> {
  // Conditional stamp: only claim the row when matched_transfer_id is still NULL (race loser no-ops).
  const res = await client.query(
    `
      UPDATE banking.bank_transactions
      SET
        status = 'transfer',
        category = 'transfer',
        category_kind = 'transfer',
        destination_bank_account_id = $2,
        transfer_kind = $3,
        paired_transaction_id = COALESCE($4, paired_transaction_id),
        matched_transfer_id = $5,
        skip_reason = NULL,
        investigate_note = NULL,
        categorized_at = now(),
        updated_at = now()
      WHERE id = $1
        AND operating_company_id = $6::uuid
        AND matched_transfer_id IS NULL
    `,
    [
      input.bankTransactionId,
      input.destinationBankAccountId,
      input.transferKind,
      input.pairedTransactionId,
      input.transferId,
      input.operatingCompanyId,
    ]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * BANK-ECON-03 / BANK-SURF-03 root-cause fix (0285-banking-transfer-gl-gap Option 1, owner-approved
 * #3134) — ROOT CAUSE: the bank-feed "mark as transfer" action tagged banking.bank_transactions with
 * transfer_kind/destination_bank_account_id but never minted a banking.transfers row, so the movement
 * never had a paired ledger entry and TRANSFER_GL_POSTING_ENABLED had nothing to post against. This
 * pairs the feed line to the destination account and mints the transfer via the EXISTING insert path
 * (Surface A) — NO new GL math, single dedupe key (matched_transfer_id) shared with
 * bank-feed-gl-posting.service.ts's "is_transfer" interlock and bank-recon's match.service.ts.
 *
 * Concurrency / double-mint safety (independent review #3445 HIGH):
 *   - One withCurrentUser txn holds pg_advisory_xact_lock(bank_txn) + SELECT … FOR UPDATE on the feed
 *     line, then insertTransferInClient + stamp in the SAME transaction. Concurrent callers serialize;
 *     createTransfer()'s separate-connection mint path is NOT used here (that was the TOCTOU hole).
 *   - Stamp is also conditional (matched_transfer_id IS NULL).
 *   - existingTransferId / already-linked / paired-leg reuse → link-only, mints nothing.
 *
 * Return `changed` so the route can gate outbox enqueue (independent review #3445 MEDIUM): idempotent
 * retries that touch nothing must not spam accounting.outbox_events → qbo.sync_runs.
 */
export async function markBankFeedLineAsTransfer(input: MarkBankFeedTransferInput) {
  const { operatingCompanyId, bankTransactionId, destinationBankAccountId, transferKind, userId } = input;
  const pairedTransactionId = input.pairedTransactionId ?? null;

  const result = await withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    // Serialize concurrent mark-as-transfer for THIS feed line (hashtext key matches cash-advance / QBO pullers).
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
      `banking.mark_transfer:${bankTransactionId}`,
    ]);

    const txn = await loadBankTransactionForTransfer(client, bankTransactionId, operatingCompanyId, {
      forUpdate: true,
    });
    if (!txn) throw new Error("bank_txn_not_found");

    // Idempotent: already linked — never re-mint, never re-stamp, never signal "changed".
    if (txn.matched_transfer_id) {
      return { transfer_id: txn.matched_transfer_id, minted: false as const, changed: false as const };
    }

    let transferId: string;
    let minted = false;

    if (input.existingTransferId) {
      const owned = await client.query<{ id: string }>(
        `SELECT id FROM banking.transfers WHERE id = $1 AND operating_company_id = $2::uuid AND revoked_at IS NULL LIMIT 1`,
        [input.existingTransferId, operatingCompanyId]
      );
      if (!owned.rows[0]?.id) throw new Error("transfer_not_found");
      transferId = owned.rows[0].id;
    } else if (pairedTransactionId) {
      const paired = await loadBankTransactionForTransfer(client, pairedTransactionId, operatingCompanyId, {
        forUpdate: true,
      });
      if (paired?.matched_transfer_id) {
        transferId = paired.matched_transfer_id;
      } else {
        const created = await mintTransferForBankFeedLineInClient(client, input, txn);
        transferId = created.id;
        minted = true;
      }
    } else {
      const created = await mintTransferForBankFeedLineInClient(client, input, txn);
      transferId = created.id;
      minted = true;
    }

    const stamped = await stampBankTransactionTransferLink(client, {
      bankTransactionId,
      operatingCompanyId,
      transferId,
      destinationBankAccountId,
      transferKind,
      pairedTransactionId,
    });
    if (!stamped) {
      // Lost the claim after lock release edge (should be rare under advisory+FOR UPDATE) — adopt winner.
      const again = await loadBankTransactionForTransfer(client, bankTransactionId, operatingCompanyId);
      if (again?.matched_transfer_id) {
        return { transfer_id: again.matched_transfer_id, minted: false as const, changed: false as const };
      }
      throw new Error("transfer_link_failed");
    }

    if (pairedTransactionId) {
      await client.query(
        `
          UPDATE banking.bank_transactions
          SET
            status = 'transfer',
            category = 'transfer',
            category_kind = 'transfer',
            paired_transaction_id = $1,
            matched_transfer_id = $2,
            categorized_at = now(),
            updated_at = now()
          WHERE id = $3
            AND operating_company_id = $4::uuid
            AND matched_transfer_id IS NULL
        `,
        [bankTransactionId, transferId, pairedTransactionId, operatingCompanyId]
      );
    }
    await appendCrudAudit(
      client,
      userId,
      "banking.transaction.transfer.linked",
      {
        resource_type: "banking.bank_transactions",
        resource_id: bankTransactionId,
        operating_company_id: operatingCompanyId,
        transfer_id: transferId,
        minted,
        paired_transaction_id: pairedTransactionId,
      },
      "info",
      "BANK-ECON-03-MARK-TRANSFER"
    );

    return { transfer_id: transferId, minted, changed: true as const };
  });

  // GL + sync only when THIS call minted (createTransfer posts after its own commit; we mirror that).
  if (result.minted) {
    await maybePostTransferGl(operatingCompanyId, result.transfer_id, userId, "initial_post");
    await enqueueSyncJob(
      operatingCompanyId,
      "transfer",
      result.transfer_id,
      payloadHash({
        transfer_id: result.transfer_id,
        transfer_type: "bank_to_bank",
        bank_transaction_id: bankTransactionId,
      }),
      userId
    );
  }

  return result;
}

async function mintTransferForBankFeedLineInClient(
  client: DbClient,
  input: MarkBankFeedTransferInput,
  txn: BankFeedTransactionRow
) {
  if (!txn.bank_account_id) throw new Error("transfer_account_not_accessible");
  const amountCents = Math.abs(Number(txn.amount_cents ?? 0));
  if (!Number.isFinite(amountCents) || amountCents <= 0) throw new Error("transfer_amount_must_be_positive");

  const fromAccountId = input.transferKind === "out" ? txn.bank_account_id : input.destinationBankAccountId;
  const toAccountId = input.transferKind === "out" ? input.destinationBankAccountId : txn.bank_account_id;
  const memo = txn.categorization_memo?.trim() || txn.description?.trim() || undefined;

  return insertTransferInClient(
    client,
    {
      operatingCompanyId: input.operatingCompanyId,
      transferType: "bank_to_bank",
      fromAccountId,
      fromAccountKind: "bank",
      toAccountId,
      toAccountKind: "bank",
      amountCents,
      transferDate: txn.transaction_date,
      memo,
    },
    input.userId
  );
}

export async function revokeTransfer(transferId: string, operatingCompanyId: string, reason: string, userId: string) {
  const transfer = await withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    const currentRes = await client.query<TransferRow>(
      `
        SELECT id, operating_company_id, from_account_id, from_account_kind, to_account_id, to_account_kind, amount_cents, revoked_at
        FROM banking.transfers
        WHERE id = $1
          AND operating_company_id = $2::uuid
        LIMIT 1
      `,
      [transferId, operatingCompanyId]
    );
    const current = currentRes.rows[0];
    if (!current) throw new Error("transfer_not_found");
    if (current.revoked_at) throw new Error("transfer_already_revoked");

    const updateRes = await client.query<TransferRow>(
      `
        UPDATE banking.transfers
        SET revoked_at = now(),
            revoked_by_user_id = $3,
            revoked_reason = $4,
            updated_at = now()
        WHERE id = $1
          AND operating_company_id = $2::uuid
        RETURNING id, operating_company_id, from_account_id, from_account_kind, to_account_id, to_account_kind, amount_cents, revoked_at
      `,
      [transferId, operatingCompanyId, userId, reason]
    );
    const revoked = updateRes.rows[0];
    if (!revoked) throw new Error("transfer_revoke_failed");

    if (revoked.from_account_kind === "bank") {
      await updateBankBalance(client, revoked.from_account_id, operatingCompanyId, Math.abs(revoked.amount_cents));
    }
    if (revoked.to_account_kind === "bank") {
      await updateBankBalance(client, revoked.to_account_id, operatingCompanyId, -Math.abs(revoked.amount_cents));
    }

    await appendCrudAudit(
      client,
      userId,
      "banking.transfer.revoked",
      {
        resource_type: "banking.transfers",
        resource_id: transferId,
        operating_company_id: operatingCompanyId,
        reason,
      },
      "warning",
      "P5-D1-TRANSFER"
    );
    return revoked;
  });

  // BANKING-GL-COMPLETION — reverse any posted transfer JE (idempotent no-op if the flag was off when the
  // transfer was created / nothing was ever posted).
  await maybePostTransferGl(transfer.operating_company_id, transfer.id, userId, "reversal");

  await enqueueSyncJob(
    transfer.operating_company_id,
    "transfer",
    transfer.id,
    payloadHash({
      transfer_id: transfer.id,
      revoked: true,
      reason,
    }),
    userId
  );

  return transfer;
}

/**
 * BANK-F12 — Law §9 reverse hop: transfer → banking.bank_transactions.
 * Feed/recon stamps banking.bank_transactions.matched_transfer_id.
 * Entity-scoped — never cross opco.
 */
const TRANSFER_MATCHED_BANK_TRANSACTION_ID_SQL = `
  (
    SELECT bt.id::text
    FROM banking.bank_transactions bt
    WHERE bt.operating_company_id = t.operating_company_id
      AND bt.matched_transfer_id = t.id
    ORDER BY bt.transaction_date DESC, bt.created_at DESC
    LIMIT 1
  )
`;

const TRANSFER_MATCHED_BANK_TRANSACTION_LABEL_SQL = `
  (
    SELECT COALESCE(
      NULLIF(TRIM(bt.description), ''),
      NULLIF(TRIM(bt.merchant_name), ''),
      'Bank transaction ' || TO_CHAR(bt.transaction_date, 'MM/DD/YYYY')
    )
    FROM banking.bank_transactions bt
    WHERE bt.operating_company_id = t.operating_company_id
      AND bt.matched_transfer_id = t.id
    ORDER BY bt.transaction_date DESC, bt.created_at DESC
    LIMIT 1
  )
`;

export async function listTransfers(input: {
  userId: string;
  operatingCompanyId: string;
  fromDate?: string;
  toDate?: string;
  type?: TransferType;
  accountId?: string;
  status?: "active" | "revoked";
  limit: number;
  offset: number;
}) {
  return withCurrentUser(input.userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [input.operatingCompanyId]);
    const values: unknown[] = [input.operatingCompanyId];
    const where: string[] = ["t.operating_company_id = $1::uuid"];
    if (input.fromDate) {
      values.push(input.fromDate);
      where.push(`t.transfer_date >= $${values.length}`);
    }
    if (input.toDate) {
      values.push(input.toDate);
      where.push(`t.transfer_date <= $${values.length}`);
    }
    if (input.type) {
      values.push(input.type);
      where.push(`t.transfer_type = $${values.length}`);
    }
    if (input.accountId) {
      values.push(input.accountId);
      where.push(`(t.from_account_id = $${values.length} OR t.to_account_id = $${values.length})`);
    }
    if (input.status === "active") where.push("t.revoked_at IS NULL");
    if (input.status === "revoked") where.push("t.revoked_at IS NOT NULL");
    values.push(input.limit, input.offset);
    const whereSql = where.join(" AND ");

    const res = await client.query(
      `
        SELECT
          t.*,
          fb.account_name AS from_bank_name,
          tb.account_name AS to_bank_name,
          fa.account_name AS from_coa_name,
          ta.account_name AS to_coa_name,
          counterparty.code AS counterparty_code,
          ${TRANSFER_MATCHED_BANK_TRANSACTION_ID_SQL} AS matched_bank_transaction_id,
          ${TRANSFER_MATCHED_BANK_TRANSACTION_LABEL_SQL} AS matched_bank_transaction_label
        FROM banking.transfers t
        LEFT JOIN banking.bank_accounts fb
          ON fb.id = t.from_account_id
         AND fb.operating_company_id = t.operating_company_id
        LEFT JOIN banking.bank_accounts tb
          ON tb.id = t.to_account_id
         AND tb.operating_company_id = t.operating_company_id
        LEFT JOIN catalogs.accounts fa
          ON fa.id = t.from_account_id
         AND fa.operating_company_id = t.operating_company_id
        LEFT JOIN catalogs.accounts ta
          ON ta.id = t.to_account_id
         AND ta.operating_company_id = t.operating_company_id
        LEFT JOIN org.companies counterparty
          ON counterparty.id = t.counterparty_company_id
        WHERE ${whereSql}
        ORDER BY t.transfer_date DESC, t.created_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}
      `,
      values
    );
    return res.rows;
  });
}

export async function getTransferDetail(transferId: string, operatingCompanyId: string, userId: string) {
  return withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    const transferRes = await client.query(
      `
        SELECT
          t.*,
          counterparty.code AS counterparty_code,
          ${TRANSFER_MATCHED_BANK_TRANSACTION_ID_SQL} AS matched_bank_transaction_id,
          ${TRANSFER_MATCHED_BANK_TRANSACTION_LABEL_SQL} AS matched_bank_transaction_label
        FROM banking.transfers t
        LEFT JOIN org.companies counterparty
          ON counterparty.id = t.counterparty_company_id
        WHERE t.id = $1
          AND t.operating_company_id = $2::uuid
        LIMIT 1
      `,
      [transferId, operatingCompanyId]
    );
    const transfer = transferRes.rows[0] ?? null;
    if (!transfer) return null;

    const auditRes = await withLuciaBypass(async (auditClient) => {
      const rows = await auditClient.query(
        `
          SELECT *
          FROM audit.audit_events
          WHERE payload->>'resource_type' = 'banking.transfers'
            AND payload->>'resource_id' = $1
          ORDER BY created_at DESC
          LIMIT 50
        `,
        [transferId]
      );
      return rows.rows;
    });

    return { transfer, audit_events: auditRes };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BANK-DOM-05 — INTERCOMPANY TRANSFERS (TRANSP <-> TRK <-> USMCA)
//
// THE DEFECT THIS FIXES: createTransfer above validates BOTH legs against one operatingCompanyId, so
// an inter-entity movement is rejected outright — there was no way to express it at all.
//
// THE MODEL (owner-ruled 2026-07-26, and STMT-3 "read-only roll-up with elimination, NEVER shared
// rows"): an intercompany movement is TWO transfer rows — one in EACH entity's own book — joined by a
// shared intercompany_transfer_group_id. Never one row spanning two entities.
//
//   initiator leg  (entity A):  A's bank account        -> A's intercompany control account
//   counterparty leg (entity B): B's intercompany account -> B's bank account
//
// The two intercompany legs are reciprocal and net to zero on consolidation, which is what
// consolidated-statements.service.ts eliminates against. The control account per (entity,
// counterparty) is resolved DETERMINISTICALLY from banking.intercompany_entity_pairs — replacing the
// vendor/customer NAME matching that service admits in its own header it falls back on.
//
// ACCOUNT CONVENTION: mirrors the account already on prod — USMCA 8000 'Inter-company - IH35
// Transportation', system_purpose 'intercompany_ih35'. A parallel due-to/due-from convention is a C2
// split-brain and is blocked by guard assertion A5.
//
// NO NEW GL MATH: each leg is an ordinary transfer row in its own entity, so each posts through the
// SAME shared posting engine (postSourceTransaction, source type "transfer") that intra-entity
// transfers already use, under the SAME per-entity TRANSFER_GL_POSTING_ENABLED flag. This service
// writes no journal rows itself (guard assertion A7).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export type IntercompanyTransferInput = {
  /** Entity initiating the movement — money leaves this book. */
  operatingCompanyId: string;
  /** The OTHER entity — money arrives in this book. */
  counterpartyCompanyId: string;
  transferType: TransferType;
  /** Initiator's real account the money leaves. */
  fromAccountId: string;
  fromAccountKind: AccountKind;
  /** Counterparty's real account the money arrives in. */
  toAccountId: string;
  toAccountKind: AccountKind;
  amountCents: number;
  transferDate: string;
  memo?: string;
  referenceNumber?: string;
};

type IntercompanyPair = { intercompany_account_id: string };

/**
 * Resolve entity A's intercompany control account for counterparty B from the owner-editable map.
 * Deterministic by construction — no name matching, no heuristic.
 */
async function resolveIntercompanyAccount(
  client: DbClient,
  operatingCompanyId: string,
  counterpartyCompanyId: string
): Promise<string> {
  const res = await client.query<IntercompanyPair>(
    `
      SELECT intercompany_account_id
      FROM banking.intercompany_entity_pairs
      WHERE operating_company_id = $1::uuid
        AND counterparty_company_id = $2
        AND deactivated_at IS NULL
      LIMIT 1
    `,
    [operatingCompanyId, counterpartyCompanyId]
  );
  const accountId = res.rows[0]?.intercompany_account_id;
  if (!accountId) {
    // Fail LOUD. A missing mapping must never silently fall back to a default account — that is the
    // "silent default" DoD-D forbids, and it would post real money to the wrong control account.
    throw new Error("intercompany_pair_not_mapped");
  }
  return accountId;
}

/**
 * The acceptance bar, asserted rather than assumed: the two reciprocal legs must net to zero.
 * Equal magnitude, opposite direction across the two books.
 */
export function assertIntercompanyLegsNetToZero(initiatorLegCents: number, counterpartyLegCents: number): void {
  const net = initiatorLegCents - counterpartyLegCents;
  if (net !== 0) {
    throw new Error(`intercompany_legs_do_not_net_to_zero:${net}`);
  }
}

/**
 * Write BOTH legs atomically. Spans two entities by definition, so a single app.operating_company_id
 * GUC cannot satisfy the RLS WITH CHECK on both rows — this uses the sanctioned lucia bypass (already
 * the pattern used for the cross-entity audit read below) and stamps each row's real
 * operating_company_id explicitly. Both legs commit together or neither does: a half-written
 * intercompany pair would be an unbalanced book.
 */
async function insertIntercompanyLegs(
  client: DbClient,
  input: IntercompanyTransferInput,
  groupId: string,
  initiatorAccountId: string,
  counterpartyAccountId: string,
  userId: string
): Promise<{ initiator: TransferRow; counterparty: TransferRow }> {
  const amount = Math.abs(input.amountCents);
  assertIntercompanyLegsNetToZero(amount, amount);

  const legs = [
    {
      leg: "initiator" as const,
      operating_company_id: input.operatingCompanyId,
      counterparty_company_id: input.counterpartyCompanyId,
      from_account_id: input.fromAccountId,
      from_account_kind: input.fromAccountKind,
      to_account_id: initiatorAccountId,
      to_account_kind: "coa" as AccountKind,
    },
    {
      leg: "counterparty" as const,
      operating_company_id: input.counterpartyCompanyId,
      counterparty_company_id: input.operatingCompanyId,
      from_account_id: counterpartyAccountId,
      from_account_kind: "coa" as AccountKind,
      to_account_id: input.toAccountId,
      to_account_kind: input.toAccountKind,
    },
  ];

  const written: TransferRow[] = [];
  for (const leg of legs) {
    const res = await client.query<TransferRow>(
      `
        INSERT INTO banking.transfers (
          operating_company_id, transfer_type,
          from_account_id, from_account_kind,
          to_account_id, to_account_kind,
          amount_cents, transfer_date, memo, reference_number,
          intercompany_transfer_group_id, counterparty_company_id, intercompany_leg,
          created_by_user_id, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now(),now())
        RETURNING id, operating_company_id, from_account_id, from_account_kind,
                  to_account_id, to_account_kind, amount_cents, revoked_at
      `,
      [
        leg.operating_company_id,
        input.transferType,
        leg.from_account_id,
        leg.from_account_kind,
        leg.to_account_id,
        leg.to_account_kind,
        amount,
        input.transferDate,
        input.memo ?? null,
        input.referenceNumber ?? null,
        groupId,
        leg.counterparty_company_id,
        leg.leg,
        userId,
      ]
    );
    const row = res.rows[0];
    if (!row) throw new Error("intercompany_leg_insert_failed");
    written.push(row);

    // Cached bank balances move only on the REAL bank sides; the intercompany control legs are CoA.
    if (leg.from_account_kind === "bank") {
      await updateBankBalance(client, leg.from_account_id, leg.operating_company_id, -amount);
    }
    if (leg.to_account_kind === "bank") {
      await updateBankBalance(client, leg.to_account_id, leg.operating_company_id, amount);
    }

    await appendCrudAudit(
      client,
      userId,
      "banking.intercompany_transfer.leg_created",
      {
        resource_type: "banking.transfers",
        resource_id: row.id,
        operating_company_id: leg.operating_company_id,
        counterparty_company_id: leg.counterparty_company_id,
        intercompany_transfer_group_id: groupId,
        intercompany_leg: leg.leg,
        amount_cents: amount,
      },
      "info",
      "BANK-DOM-05"
    );
  }

  return { initiator: written[0]!, counterparty: written[1]! };
}

/**
 * Create an intercompany transfer: two reciprocal legs, one per entity book, netting to zero.
 * Both entities' GL posts run through the shared poster afterwards, each under its OWN entity's
 * TRANSFER_GL_POSTING_ENABLED flag — one entity being enabled never posts for the other.
 */
export async function createIntercompanyTransfer(input: IntercompanyTransferInput, userId: string) {
  if (input.amountCents <= 0) throw new Error("transfer_amount_must_be_positive");
  if (input.operatingCompanyId === input.counterpartyCompanyId) {
    throw new Error("intercompany_requires_two_distinct_entities");
  }

  const legs = await withLuciaBypass(async (client) => {
    // The group PARENT ROW is written first so both legs FK into a row that exists — a bare grouping
    // uuid with no parent table is the C13 defect class this block exists to avoid.
    const groupRes = await client.query<{ id: string }>(
      `
        INSERT INTO banking.intercompany_transfer_groups
          (operating_company_id, counterparty_company_id, created_by_user_id)
        VALUES ($1, $2, $3)
        RETURNING id
      `,
      [input.operatingCompanyId, input.counterpartyCompanyId, userId]
    );
    const groupId = groupRes.rows[0]?.id;
    if (!groupId) throw new Error("intercompany_group_insert_failed");

    const initiatorAccountId = await resolveIntercompanyAccount(
      client as unknown as DbClient,
      input.operatingCompanyId,
      input.counterpartyCompanyId
    );
    const counterpartyAccountId = await resolveIntercompanyAccount(
      client as unknown as DbClient,
      input.counterpartyCompanyId,
      input.operatingCompanyId
    );
    const written = await insertIntercompanyLegs(
      client as unknown as DbClient,
      input,
      groupId,
      initiatorAccountId,
      counterpartyAccountId,
      userId
    );
    return { groupId, ...written };
  });

  // Post each leg in ITS OWN entity, through the shared posting engine. Same flag discipline as
  // intra-entity transfers: resolved per-entity, default OFF.
  await maybePostTransferGl(legs.initiator.operating_company_id, legs.initiator.id, userId, "initial_post");
  await maybePostTransferGl(legs.counterparty.operating_company_id, legs.counterparty.id, userId, "initial_post");

  return { intercompany_transfer_group_id: legs.groupId, initiator: legs.initiator, counterparty: legs.counterparty };
}

/**
 * The pair map is OWNER-EDITABLE by design, so it needs a management path — otherwise the
 * deactivation columns are dead schema (a column nothing reads implies a feature that does not
 * exist, §10a linkage law). Entity-scoped: an entity sees only its own mappings.
 */
export async function listIntercompanyPairs(operatingCompanyId: string, userId: string, includeInactive = false) {
  return withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    const res = await client.query(
      `
        SELECT p.id, p.operating_company_id, p.counterparty_company_id, c.code AS counterparty_code,
               p.intercompany_account_id, a.account_number, a.account_name, a.system_purpose,
               p.notes, p.created_at, p.created_by_user_id,
               p.deactivated_at, p.deactivated_by_user_id
          FROM banking.intercompany_entity_pairs p
          JOIN org.companies c ON c.id = p.counterparty_company_id
          LEFT JOIN catalogs.accounts a ON a.id = p.intercompany_account_id AND a.operating_company_id = p.operating_company_id
         WHERE p.operating_company_id = $1::uuid
           AND ($2::boolean = true OR p.deactivated_at IS NULL)
         ORDER BY c.code
      `,
      [operatingCompanyId, includeInactive]
    );
    return res.rows;
  });
}

/** void-not-delete: a mapping is deactivated and stamped, never removed (REVOKE DELETE in the migration). */
export async function deactivateIntercompanyPair(pairId: string, operatingCompanyId: string, userId: string) {
  return withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    const res = await client.query<{ id: string; deactivated_at: string; deactivated_by_user_id: string }>(
      `
        UPDATE banking.intercompany_entity_pairs
           SET deactivated_at = now(), deactivated_by_user_id = $3, updated_at = now()
         WHERE id = $1
           AND operating_company_id = $2::uuid
           AND deactivated_at IS NULL
        RETURNING id, deactivated_at, deactivated_by_user_id
      `,
      [pairId, operatingCompanyId, userId]
    );
    const row = res.rows[0];
    if (!row) throw new Error("intercompany_pair_not_found_or_already_deactivated");

    await appendCrudAudit(
      client,
      userId,
      "banking.intercompany_entity_pair.deactivated",
      {
        resource_type: "banking.intercompany_entity_pairs",
        resource_id: row.id,
        operating_company_id: operatingCompanyId,
        deactivated_by_user_id: row.deactivated_by_user_id,
      },
      "info",
      "BANK-DOM-05"
    );
    return row;
  });
}

/** Reverse drill: both legs of one intercompany movement, from either side. */
export async function getIntercompanyTransferGroup(groupId: string, operatingCompanyId: string) {
  return withLuciaBypass(async (client) => {
    const res = await client.query(
      `
        SELECT t.id, t.operating_company_id, t.counterparty_company_id, t.intercompany_leg,
               t.from_account_id, t.from_account_kind, t.to_account_id, t.to_account_kind,
               t.amount_cents, t.transfer_date, t.memo, t.reference_number, t.revoked_at,
               c.code AS entity_code
          FROM banking.transfers t
          JOIN org.companies c ON c.id = t.operating_company_id
         WHERE t.intercompany_transfer_group_id = $1
           AND (t.operating_company_id = $2::uuid OR t.counterparty_company_id = $2)
         ORDER BY t.intercompany_leg
      `,
      [groupId, operatingCompanyId]
    );
    return res.rows;
  });
}
