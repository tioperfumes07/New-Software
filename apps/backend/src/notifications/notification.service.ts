import { withLuciaBypass } from "../auth/db.js";

export type NotificationType =
  | "compliance_expiring"
  | "compliance_expired"
  | "maintenance_alert"
  | "load_status"
  | "driver_alert"
  | "system"
  | "message"
  | "insurance_monthly_report"
  | "insurance_monthly_report_error";

export type NotificationSeverity = "info" | "low" | "medium" | "high" | "critical";

export type CreateNotificationInput = {
  operating_company_id: string;
  user_id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body?: string | null;
  action_link?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  source_block?: string | null;
};

type DbClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

export async function createNotification(
  input: CreateNotificationInput,
  client?: DbClient
): Promise<{ id: string } | null> {
  const run = async (c: DbClient) => {
    await c.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [input.operating_company_id]);
    const res = await c.query<{ id: string }>(
      `
        INSERT INTO notifications.user_notifications (
          operating_company_id, user_id, type, severity, title, body,
          action_link, entity_type, entity_id, source_block
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::uuid, $10)
        RETURNING id::text
      `,
      [
        input.operating_company_id,
        input.user_id,
        input.type,
        input.severity,
        input.title,
        input.body ?? null,
        input.action_link ?? null,
        input.entity_type ?? null,
        input.entity_id ?? null,
        input.source_block ?? null,
      ]
    );
    return res.rows[0] ?? null;
  };

  if (client) return run(client);
  return withLuciaBypass(async (c) => run(c));
}

export async function listCompanyNotifyUserIds(
  client: DbClient,
  operatingCompanyId: string,
  roles: string[] = ["Owner", "Administrator", "Manager"]
): Promise<string[]> {
  const res = await client.query<{ id: string }>(
    `
      SELECT DISTINCT u.id::text
      FROM identity.users u
      LEFT JOIN org.user_company_access uca ON uca.user_id = u.id
      WHERE u.deactivated_at IS NULL
        AND u.role::text = ANY($2::text[])
        AND (
          u.default_company_id = $1::uuid
          OR uca.company_id = $1::uuid
        )
    `,
    [operatingCompanyId, roles]
  );
  return res.rows.map((row) => row.id);
}

export type PredictiveAutoWoNotificationInput = {
  operating_company_id: string;
  unit_label: string;
  fault_description: string;
  severity: string;
  work_order_id: string;
};

/** Block 22: in-app alerts when fault-driven draft work orders are auto-created. */
export async function emitPredictiveAutoWoNotifications(
  client: DbClient,
  input: PredictiveAutoWoNotificationInput
): Promise<void> {
  const userIds = await listCompanyNotifyUserIds(client, input.operating_company_id, [
    "Owner",
    "Administrator",
    "Manager",
  ]);
  const notifSeverity: NotificationSeverity =
    input.severity === "critical" ? "critical" : input.severity === "high" ? "high" : "medium";

  for (const userId of userIds) {
    await createNotification(
      {
        operating_company_id: input.operating_company_id,
        user_id: userId,
        type: "maintenance_alert",
        severity: notifSeverity,
        title: `Auto-created draft WO for ${input.unit_label}: ${input.fault_description} (${input.severity})`,
        body: `Review and assign shop for fault-driven draft work order.`,
        action_link: `/maintenance/work-orders/${input.work_order_id}`,
        entity_type: "work_order",
        entity_id: input.work_order_id,
        source_block: "predictive_auto_wo",
      },
      client
    );
  }
}
