import type { FastifyInstance } from "fastify";
import cron from "node-cron";
import { withLuciaBypass } from "../auth/db.js";
import { companyBusinessDate } from "../lib/company-business-date.js";
import { wrapBackgroundJobTick } from "../lib/background-jobs.js";
import { assertTenantContext } from "./_helpers/tenant-context-guard.js";
import { listActiveOperatingCompanyIds } from "./depreciation-autopost.cron.js";
import { getRollingLedgerRows, type RollingLedgerRow } from "../cash-flow/cash-flow.service.js";
import { createNotification, listCompanyNotifyUserIds } from "../notifications/notification.service.js";

// CASH-FLOW-02 part (b) (owner order 2026-09-06 20:1xZ, item 5): "an overdue row past 3 days
// raises an in-app notification (existing notification bus), once per row, with the link." This
// cron scans every open obligation via the SAME read model the Rolling Ledger tab renders
// (getRollingLedgerRows — never a re-derived, potentially-diverging query), finds rows more than
// 3 days overdue, and creates ONE notification per row (deduped by entity_type+entity_id+
// source_block, never re-fired once created — a row that stays overdue forever raises exactly
// one alert, not a daily flood).

const CRON_NAME = "cash_flow.rolling_ledger_notify";
const CRON_EXPRESSION = "20 6 * * *"; // daily 06:20 America/Chicago — right after the projection snapshot cron
const CRON_TZ = "America/Chicago";
const SOURCE_BLOCK = "cash-flow-rolling-ledger";
const OVERDUE_THRESHOLD_DAYS = 3;

let initialized = false;

type DbClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function notificationTitle(row: RollingLedgerRow): string {
  const verb = row.row_kind === "income" ? "overdue" : "overdue";
  return `${row.type} ${verb} ${row.days_overdue}d: ${row.counterparty} — ${formatUsd(row.amount_cents)}`;
}

export async function notifyOverdueRollingLedgerRow(
  client: DbClient,
  operatingCompanyId: string,
  row: RollingLedgerRow
): Promise<{ created: boolean }> {
  const existing = await client.query<{ id: string }>(
    `
      SELECT id::text FROM notifications.user_notifications
      WHERE operating_company_id = $1::uuid
        AND entity_type = $2
        AND entity_id = $3::uuid
        AND source_block = $4
      LIMIT 1
    `,
    [operatingCompanyId, row.document_kind, row.document_id, SOURCE_BLOCK]
  );
  if (existing.rows.length > 0) return { created: false };

  const notifyUserIds = await listCompanyNotifyUserIds(client, operatingCompanyId);
  for (const userId of notifyUserIds) {
    await createNotification(
      {
        operating_company_id: operatingCompanyId,
        user_id: userId,
        type: "system",
        severity: row.days_overdue >= 14 ? "high" : "medium",
        title: notificationTitle(row),
        body: `Due ${row.due_date}, originated ${row.origin_date}. Now ${row.days_overdue} day(s) overdue.`,
        action_link: `/cash-flow?tab=rolling_ledger`,
        entity_type: row.document_kind,
        entity_id: row.document_id,
        source_block: SOURCE_BLOCK,
      },
      client
    );
  }
  return { created: notifyUserIds.length > 0 };
}

export async function runCashFlowRollingLedgerNotifyCronTick(deps?: {
  withLuciaBypassImpl?: typeof withLuciaBypass;
  getRollingLedgerRowsImpl?: typeof getRollingLedgerRows;
  today?: string;
}) {
  const withLuciaBypassImpl = deps?.withLuciaBypassImpl ?? withLuciaBypass;
  const getRollingLedgerRowsImpl = deps?.getRollingLedgerRowsImpl ?? getRollingLedgerRows;
  const today = deps?.today ?? companyBusinessDate();

  const companyIds = await withLuciaBypassImpl(async (client) => listActiveOperatingCompanyIds(client));
  const summary = { company_count: companyIds.length, checked: 0, notified: 0, error: 0 };

  for (const operatingCompanyId of companyIds) {
    assertTenantContext(operatingCompanyId, CRON_NAME);
    try {
      const rows = await withLuciaBypassImpl((client) => getRollingLedgerRowsImpl(client, operatingCompanyId, today));
      const overdueRows = rows.filter((r) => r.days_overdue > OVERDUE_THRESHOLD_DAYS);
      summary.checked += overdueRows.length;
      for (const row of overdueRows) {
        const { created } = await withLuciaBypassImpl((client) => notifyOverdueRollingLedgerRow(client, operatingCompanyId, row));
        if (created) summary.notified += 1;
      }
    } catch {
      summary.error += 1;
    }
  }

  return summary;
}

export function initializeCashFlowRollingLedgerNotifyCron(app: FastifyInstance) {
  if (initialized) return;
  initialized = true;

  cron.schedule(
    CRON_EXPRESSION,
    async () => {
      await wrapBackgroundJobTick(
        CRON_NAME,
        async () => {
          const summary = await runCashFlowRollingLedgerNotifyCronTick();
          app.log.info(summary, "cash-flow rolling-ledger overdue-notify cron completed");
        },
        app.log
      );
    },
    { maxRandomDelay: 20000 /* cron-stagger — see PROD-OUTAGE-STEADY-STATE-CRON-PILEUP-CONFIRMED */, timezone: CRON_TZ }
  );

  app.log.info("Cash-flow rolling-ledger overdue-notify cron scheduled (daily 06:20 America/Chicago)");
}
