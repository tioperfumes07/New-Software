import { z } from "zod";
import { DISPATCH_ACTIVE_LOAD_STATUSES } from "../dispatch/active-loads-count.js";
import { companyBusinessDate } from "../lib/company-business-date.js";

export type QueryableClient = {
  query: (query: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

const leaveTypeSchema = z.enum(["vacation", "sick", "personal", "wfh"]);
const reviewActionSchema = z.enum(["approve", "approve_modified", "deny", "defer"]);

export const createLeaveRequestSchema = z.object({
  leave_type: leaveTypeSchema,
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(1).max(2000),
  documentation_attachment_id: z.string().uuid().optional(),
  suggested_cover_driver_id: z.string().uuid().optional(),
});

export const attachLeaveDocumentationSchema = z.object({
  documentation_attachment_id: z.string().uuid(),
});

export const reviewLeaveRequestSchema = z.object({
  action: reviewActionSchema,
  approved_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  approved_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  modification_reason: z.string().trim().max(2000).optional(),
  denied_reason: z.string().trim().max(2000).optional(),
});

export const assignTempCoverSchema = z.object({
  primary_driver_id: z.string().uuid(),
  cover_driver_id: z.string().uuid(),
  unit_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  related_leave_request_id: z.string().uuid().optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const updateLeavePolicySchema = z.object({
  vacation_days_per_year: z.number().int().min(0).max(365).optional(),
  sick_days_per_year: z.number().int().min(0).max(365).optional(),
  personal_days_per_year: z.number().int().min(0).max(365).optional(),
  vacation_advance_notice_days: z.number().int().min(0).max(365).optional(),
  personal_advance_notice_days: z.number().int().min(0).max(365).optional(),
  sick_requires_doc_after_days: z.number().int().min(0).max(30).optional(),
  carryover_vacation_days_max: z.number().int().min(0).max(365).optional(),
});

function daysInclusive(startIso: string, endIso: string): number {
  const [ys, ms, ds] = startIso.split("-").map(Number);
  const [ye, me, de] = endIso.split("-").map(Number);
  const a = Date.UTC(ys, ms - 1, ds);
  const b = Date.UTC(ye, me - 1, de);
  return Math.floor((b - a) / 86_400_000) + 1;
}

function enumerateDates(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const [ys, ms, ds] = startIso.split("-").map(Number);
  const [ye, me, de] = endIso.split("-").map(Number);
  let t = Date.UTC(ys, ms - 1, ds);
  const end = Date.UTC(ye, me - 1, de);
  while (t <= end) {
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
    t += 86_400_000;
  }
  return out;
}

function daysUntilStart(startIso: string): number {
  const today = companyBusinessDate();
  return daysInclusive(today, startIso) - 1;
}

async function appendLeaveAudit(
  client: QueryableClient,
  args: {
    operatingCompanyId: string;
    leaveRequestId?: string | null;
    eventType: string;
    payload?: Record<string, unknown>;
    actorUserId?: string | null;
    actorName?: string | null;
  }
) {
  await client.query(
    `
      INSERT INTO safety.driver_leave_audit_log (
        operating_company_id,
        leave_request_id,
        event_type,
        event_payload,
        actor_user_id,
        actor_name
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $6)
    `,
    [
      args.operatingCompanyId,
      args.leaveRequestId ?? null,
      args.eventType,
      JSON.stringify(args.payload ?? {}),
      args.actorUserId ?? null,
      args.actorName ?? null,
    ]
  );
}

async function nextRequestNumber(client: QueryableClient, operatingCompanyId: string): Promise<string> {
  const year = Number(companyBusinessDate().slice(0, 4));
  const prefix = `DLS-${year}-`;
  const res = await client.query(
    `
      SELECT request_number
      FROM safety.driver_leave_requests
      WHERE operating_company_id = $1::uuid
        AND request_number LIKE $2
      ORDER BY request_number DESC
      LIMIT 1
    `,
    [operatingCompanyId, `${prefix}%`]
  );
  let next = 1;
  const last = res.rows[0]?.request_number;
  if (last && typeof last === "string") {
    const n = parseInt(last.slice(prefix.length), 10);
    if (!Number.isNaN(n)) next = n + 1;
  }
  return `${prefix}${String(next).padStart(6, "0")}`;
}

async function enqueueOutbox(client: QueryableClient, eventType: string, payload: Record<string, unknown>) {
  /* outbox-handler-parity: literal-types=["driver.scheduler.leave_requested","driver.scheduler.leave_denied","driver.scheduler.leave_approved","driver.scheduler.temp_cover_assigned"] */
  await client.query(
    `
      INSERT INTO outbox.events (event_type, payload, next_retry_at)
      VALUES ($1, $2::jsonb, now())
    `,
    [eventType, JSON.stringify(payload)]
  );
}

export async function getLeavePolicy(client: QueryableClient, operatingCompanyId: string) {
  const res = await client.query(
    `SELECT * FROM catalogs.leave_policies WHERE operating_company_id = $1::uuid LIMIT 1`,
    [operatingCompanyId]
  );
  return res.rows[0] ?? null;
}

export async function updateLeavePolicy(
  client: QueryableClient,
  args: {
    operatingCompanyId: string;
    actorUserId: string;
    updates: z.infer<typeof updateLeavePolicySchema>;
  }
) {
  const parsed = updateLeavePolicySchema.parse(args.updates);
  const parts: string[] = [];
  const values: unknown[] = [];
  const add = (col: string, v: number) => {
    values.push(v);
    parts.push(`${col} = $${values.length}`);
  };
  if (parsed.vacation_days_per_year !== undefined) add("vacation_days_per_year", parsed.vacation_days_per_year);
  if (parsed.sick_days_per_year !== undefined) add("sick_days_per_year", parsed.sick_days_per_year);
  if (parsed.personal_days_per_year !== undefined) add("personal_days_per_year", parsed.personal_days_per_year);
  if (parsed.vacation_advance_notice_days !== undefined)
    add("vacation_advance_notice_days", parsed.vacation_advance_notice_days);
  if (parsed.personal_advance_notice_days !== undefined)
    add("personal_advance_notice_days", parsed.personal_advance_notice_days);
  if (parsed.sick_requires_doc_after_days !== undefined)
    add("sick_requires_doc_after_days", parsed.sick_requires_doc_after_days);
  if (parsed.carryover_vacation_days_max !== undefined)
    add("carryover_vacation_days_max", parsed.carryover_vacation_days_max);
  if (parts.length === 0) return { error: "no_updates" as const };

  values.push(args.actorUserId);
  parts.push(`updated_by_user_id = $${values.length}`);
  parts.push(`updated_at = now()`);
  values.push(args.operatingCompanyId);

  const res = await client.query(
    `
      UPDATE catalogs.leave_policies
      SET ${parts.join(", ")}
      WHERE operating_company_id = $${values.length}::uuid
      RETURNING *
    `,
    values
  );
  const row = res.rows[0] ?? null;
  if (!row) return { error: "leave_policy_not_found" as const };

  await appendLeaveAudit(client, {
    operatingCompanyId: args.operatingCompanyId,
    eventType: "leave_policy_updated",
    payload: { updates: parsed },
    actorUserId: args.actorUserId,
  });
  return { policy: row };
}

export async function ensureLeaveBalanceRow(
  client: QueryableClient,
  operatingCompanyId: string,
  driverId: string,
  planYear: number
) {
  const policy = await getLeavePolicy(client, operatingCompanyId);
  if (!policy) return;

  await client.query(
    `
      INSERT INTO catalogs.driver_leave_balances (
        operating_company_id,
        driver_id,
        plan_year,
        vacation_allocated,
        sick_allocated,
        personal_allocated
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (operating_company_id, driver_id, plan_year) DO NOTHING
    `,
    [
      operatingCompanyId,
      driverId,
      planYear,
      policy.vacation_days_per_year ?? 0,
      policy.sick_days_per_year ?? 0,
      policy.personal_days_per_year ?? 0,
    ]
  );
}

export async function getLeaveBalance(client: QueryableClient, operatingCompanyId: string, driverId: string, year: number) {
  await ensureLeaveBalanceRow(client, operatingCompanyId, driverId, year);
  const res = await client.query(
    `
      SELECT * FROM catalogs.driver_leave_balances
      WHERE operating_company_id = $1::uuid AND driver_id = $2 AND plan_year = $3
      LIMIT 1
    `,
    [operatingCompanyId, driverId, year]
  );
  return res.rows[0] ?? null;
}

/**
 * Office Leave Balances tab — every active (non-sample) driver for the entity + plan year,
 * seeded from catalogs.leave_policies when a balance row is missing.
 */
export async function listLeaveBalances(
  client: QueryableClient,
  operatingCompanyId: string,
  planYear: number
) {
  const policy = await getLeavePolicy(client, operatingCompanyId);
  if (!policy) return { policy: null, year: planYear, balances: [] as Record<string, unknown>[] };

  await client.query(
    `
      INSERT INTO catalogs.driver_leave_balances (
        operating_company_id,
        driver_id,
        plan_year,
        vacation_allocated,
        sick_allocated,
        personal_allocated
      )
      SELECT
        $1,
        d.id,
        $2,
        $3,
        $4,
        $5
      FROM mdata.drivers d
      WHERE d.operating_company_id = $1::uuid
        AND d.deactivated_at IS NULL
        AND d.is_sample_data IS NOT TRUE
        AND concat_ws(' ', d.first_name, d.last_name) NOT ILIKE '%DEMO%'
        AND concat_ws(' ', d.first_name, d.last_name) NOT ILIKE '%DUMMY%'
        AND concat_ws(' ', d.first_name, d.last_name) NOT ILIKE 'TEST%'
      ON CONFLICT (operating_company_id, driver_id, plan_year) DO NOTHING
    `,
    [
      operatingCompanyId,
      planYear,
      policy.vacation_days_per_year ?? 0,
      policy.sick_days_per_year ?? 0,
      policy.personal_days_per_year ?? 0,
    ]
  );

  const res = await client.query(
    `
      SELECT
        b.id,
        b.driver_id,
        concat_ws(' ', d.first_name, d.last_name) AS driver_name,
        d.status::text AS driver_status,
        b.plan_year,
        b.vacation_allocated,
        b.vacation_used,
        GREATEST(b.vacation_allocated - b.vacation_used, 0) AS vacation_remaining,
        b.sick_allocated,
        b.sick_used,
        GREATEST(b.sick_allocated - b.sick_used, 0) AS sick_remaining,
        b.personal_allocated,
        b.personal_used,
        GREATEST(b.personal_allocated - b.personal_used, 0) AS personal_remaining
      FROM catalogs.driver_leave_balances b
      JOIN mdata.drivers d ON d.id = b.driver_id
                           AND (d.operating_company_id = $1::uuid OR EXISTS (
                             SELECT 1 FROM mdata.driver_company_authorizations leave_balances_dca
                             WHERE leave_balances_dca.driver_id = d.id
                               AND leave_balances_dca.company_id = $1::uuid
                               AND leave_balances_dca.is_authorized = true
                               AND leave_balances_dca.deactivated_at IS NULL
                           ))
      WHERE b.operating_company_id = $1::uuid
        AND b.plan_year = $2
        AND d.deactivated_at IS NULL
        AND d.is_sample_data IS NOT TRUE
      ORDER BY d.last_name, d.first_name
    `,
    [operatingCompanyId, planYear]
  );
  return { policy, year: planYear, balances: res.rows };
}

async function hasApprovedOverlap(
  client: QueryableClient,
  driverId: string,
  startIso: string,
  endIso: string
): Promise<boolean> {
  const res = await client.query(
    `
      SELECT 1
      FROM safety.driver_leave_days ld
      WHERE ld.driver_id = $1
        AND ld.voided_at IS NULL
        AND ld.leave_date BETWEEN $2::date AND $3::date
      LIMIT 1
    `,
    [driverId, startIso, endIso]
  );
  return res.rows.length > 0;
}

async function hasPendingOverlap(
  client: QueryableClient,
  operatingCompanyId: string,
  driverId: string,
  startIso: string,
  endIso: string
): Promise<boolean> {
  const res = await client.query(
    `
      SELECT 1
      FROM safety.driver_leave_requests r
      WHERE r.operating_company_id = $1::uuid
        AND r.driver_id = $2
        AND r.status = 'pending_review'
        AND r.voided_at IS NULL
        AND r.start_date <= $4::date
        AND r.end_date >= $3::date
      LIMIT 1
    `,
    [operatingCompanyId, driverId, startIso, endIso]
  );
  return res.rows.length > 0;
}

export async function createDriverLeaveRequest(
  client: QueryableClient,
  args: {
    operatingCompanyId: string;
    driverId: string;
    actorUserId: string;
    body: z.infer<typeof createLeaveRequestSchema>;
  }
) {
  const input = createLeaveRequestSchema.parse(args.body);
  if (daysInclusive(input.start_date, input.end_date) < 1) {
    return { error: "leave_invalid_dates" as const };
  }

  const policyRow = await getLeavePolicy(client, args.operatingCompanyId);
  if (!policyRow) return { error: "leave_policy_not_found" as const };

  const policy = policyRow as Record<string, unknown>;
  const noticeVac = Number(policy.vacation_advance_notice_days ?? 0);
  const noticePer = Number(policy.personal_advance_notice_days ?? 0);
  const sickDocAfter = Number(policy.sick_requires_doc_after_days ?? 1);

  const until = daysUntilStart(input.start_date);
  if (input.leave_type === "vacation" && until < noticeVac) {
    return { error: "leave_vacation_advance_notice", details: { required_days: noticeVac } };
  }
  if (input.leave_type === "personal" && noticePer > 0 && until < noticePer) {
    return { error: "leave_personal_advance_notice", details: { required_days: noticePer } };
  }

  const span = daysInclusive(input.start_date, input.end_date);
  if (input.leave_type === "sick" && span > sickDocAfter && !input.documentation_attachment_id) {
    return { error: "leave_sick_doc_required", details: { sick_requires_doc_after_days: sickDocAfter } };
  }

  if (await hasApprovedOverlap(client, args.driverId, input.start_date, input.end_date)) {
    return { error: "leave_overlaps_approved" as const };
  }
  if (await hasPendingOverlap(client, args.operatingCompanyId, args.driverId, input.start_date, input.end_date)) {
    return { error: "leave_overlaps_pending" as const };
  }

  const planYear = Number(input.start_date.slice(0, 4));
  if (input.leave_type !== "wfh") {
    await ensureLeaveBalanceRow(client, args.operatingCompanyId, args.driverId, planYear);
    const balRes = await client.query(
      `
        SELECT * FROM catalogs.driver_leave_balances
        WHERE operating_company_id = $1::uuid AND driver_id = $2 AND plan_year = $3
        LIMIT 1
      `,
      [args.operatingCompanyId, args.driverId, planYear]
    );
    const bal = balRes.rows[0] as Record<string, number> | undefined;
    if (bal) {
      if (input.leave_type === "vacation" && bal.vacation_used + span > bal.vacation_allocated) {
        return { error: "leave_vacation_balance_exceeded" as const };
      }
      if (input.leave_type === "sick" && bal.sick_used + span > bal.sick_allocated) {
        return { error: "leave_sick_balance_exceeded" as const };
      }
      if (input.leave_type === "personal" && bal.personal_used + span > bal.personal_allocated) {
        return { error: "leave_personal_balance_exceeded" as const };
      }
    }
  }

  const requestNumber = await nextRequestNumber(client, args.operatingCompanyId);
  const ins = await client.query(
    `
      INSERT INTO safety.driver_leave_requests (
        operating_company_id,
        driver_id,
        request_number,
        leave_type,
        start_date,
        end_date,
        reason,
        documentation_attachment_id,
        suggested_cover_driver_id,
        status
      ) VALUES ($1,$2,$3,$4::text,$5::date,$6::date,$7,$8,$9,'pending_review')
      RETURNING *
    `,
    [
      args.operatingCompanyId,
      args.driverId,
      requestNumber,
      input.leave_type,
      input.start_date,
      input.end_date,
      input.reason,
      input.documentation_attachment_id ?? null,
      input.suggested_cover_driver_id ?? null,
    ]
  );
  const row = ins.rows[0];

  await appendLeaveAudit(client, {
    operatingCompanyId: args.operatingCompanyId,
    leaveRequestId: String(row.id),
    eventType: "leave_request_created",
    payload: {
      request_number: row.request_number,
      leave_type: input.leave_type,
      start_date: input.start_date,
      end_date: input.end_date,
    },
    actorUserId: args.actorUserId,
  });

  await enqueueOutbox(client, "driver.scheduler.leave_requested", {
    operating_company_id: args.operatingCompanyId,
    leave_request_id: row.id,
    driver_id: args.driverId,
    request_number: row.request_number,
  });

  return { request: row };
}

export async function cancelDriverLeaveRequest(
  client: QueryableClient,
  args: {
    operatingCompanyId: string;
    driverId: string;
    requestId: string;
    actorUserId: string;
  }
) {
  const res = await client.query(
    `
      UPDATE safety.driver_leave_requests
      SET
        status = 'cancelled',
        voided_at = now(),
        voided_by_user_id = $4,
        void_reason = 'driver_cancelled'
      WHERE operating_company_id = $1::uuid
        AND id = $2
        AND driver_id = $3
        AND status = 'pending_review'
        AND voided_at IS NULL
      RETURNING *
    `,
    [args.operatingCompanyId, args.requestId, args.driverId, args.actorUserId]
  );
  const row = res.rows[0] ?? null;
  if (!row) return null;

  await appendLeaveAudit(client, {
    operatingCompanyId: args.operatingCompanyId,
    leaveRequestId: String(row.id),
    eventType: "leave_request_cancelled",
    payload: { request_number: row.request_number },
    actorUserId: args.actorUserId,
  });
  return row;
}

export async function attachLeaveRequestDocumentation(
  client: QueryableClient,
  args: {
    operatingCompanyId: string;
    driverId: string;
    requestId: string;
    attachmentId: string;
    actorUserId: string;
  }
) {
  const res = await client.query(
    `
      UPDATE safety.driver_leave_requests
      SET documentation_attachment_id = $4
      WHERE operating_company_id = $1::uuid
        AND id = $2
        AND driver_id = $3
        AND status = 'pending_review'
        AND voided_at IS NULL
      RETURNING *
    `,
    [args.operatingCompanyId, args.requestId, args.driverId, args.attachmentId]
  );
  const row = res.rows[0] ?? null;
  if (!row) return { error: "leave_request_not_documentable" as const };

  await appendLeaveAudit(client, {
    operatingCompanyId: args.operatingCompanyId,
    leaveRequestId: args.requestId,
    eventType: "leave_documentation_attached",
    payload: { documentation_attachment_id: args.attachmentId },
    actorUserId: args.actorUserId,
  });

  return { request: row };
}

export async function listMyLeaveRequests(
  client: QueryableClient,
  operatingCompanyId: string,
  driverId: string,
  limit: number,
  offset: number,
) {
  const countRes = await client.query(
    `
      SELECT COUNT(*)::int AS total_count
      FROM safety.driver_leave_requests
      WHERE operating_company_id = $1::uuid
        AND driver_id = $2
    `,
    [operatingCompanyId, driverId]
  );
  const res = await client.query(
    `
      SELECT *
      FROM safety.driver_leave_requests
      WHERE operating_company_id = $1::uuid
        AND driver_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT $3
      OFFSET $4
    `,
    [operatingCompanyId, driverId, limit, offset]
  );
  return { requests: res.rows, totalCount: Number(countRes.rows[0]?.total_count ?? 0) };
}

export async function getMySchedule(
  client: QueryableClient,
  args: { operatingCompanyId: string; driverId: string; startDate: string; endDate: string }
) {
  const daysRes = await client.query(
    `
      SELECT ld.leave_date::text AS d, ld.leave_type, r.status AS request_status, r.request_number
      FROM safety.driver_leave_days ld
      JOIN safety.driver_leave_requests r ON r.id = ld.leave_request_id
      WHERE ld.operating_company_id = $1::uuid
        AND ld.driver_id = $2
        AND ld.voided_at IS NULL
        AND ld.leave_date BETWEEN $3::date AND $4::date
    `,
    [args.operatingCompanyId, args.driverId, args.startDate, args.endDate]
  );

  const pendingRes = await client.query(
    `
      SELECT id, request_number, leave_type, start_date, end_date, status
      FROM safety.driver_leave_requests
      WHERE operating_company_id = $1::uuid
        AND driver_id = $2
        AND status = 'pending_review'
        AND voided_at IS NULL
        AND end_date >= $3::date
        AND start_date <= $4::date
    `,
    [args.operatingCompanyId, args.driverId, args.startDate, args.endDate]
  );

  return { approved_days: daysRes.rows, pending_requests: pendingRes.rows };
}

export async function listPendingLeaveRequests(
  client: QueryableClient,
  operatingCompanyId: string,
  limit: number,
  offset: number,
) {
  const countRes = await client.query(
    `
      SELECT COUNT(*)::text AS total_count
      FROM safety.driver_leave_requests r
      WHERE r.operating_company_id = $1::uuid
        AND r.status = 'pending_review'
        AND r.voided_at IS NULL
    `,
    [operatingCompanyId],
  ) as { rows: Array<{ total_count: string }> };
  const res = await client.query(
    `
      SELECT r.*,
        concat_ws(' ', d.first_name, d.last_name) AS driver_name
      FROM safety.driver_leave_requests r
      JOIN mdata.drivers d ON d.id = r.driver_id
                           AND (d.operating_company_id = $1::uuid OR EXISTS (
                             SELECT 1 FROM mdata.driver_company_authorizations pending_leave_dca
                             WHERE pending_leave_dca.driver_id = d.id
                               AND pending_leave_dca.company_id = $1::uuid
                               AND pending_leave_dca.is_authorized = true
                               AND pending_leave_dca.deactivated_at IS NULL
                           ))
      WHERE r.operating_company_id = $1::uuid
        AND r.status = 'pending_review'
        AND r.voided_at IS NULL
      ORDER BY r.start_date ASC, r.created_at ASC
      LIMIT $2
      OFFSET $3
    `,
    [operatingCompanyId, limit, offset]
  );
  return { requests: res.rows, totalCount: Number(countRes.rows[0]?.total_count ?? 0) };
}

export async function listAllLeaveRequests(client: QueryableClient, operatingCompanyId: string, limit = 200, offset = 0) {
  const countRes = await client.query(
    `SELECT COUNT(*)::int AS total_count
     FROM safety.driver_leave_requests
     WHERE operating_company_id = $1::uuid`,
    [operatingCompanyId],
  );
  const res = await client.query(
    `
      SELECT r.*,
        concat_ws(' ', d.first_name, d.last_name) AS driver_name
      FROM safety.driver_leave_requests r
      JOIN mdata.drivers d ON d.id = r.driver_id
                           AND (d.operating_company_id = $1::uuid OR EXISTS (
                             SELECT 1 FROM mdata.driver_company_authorizations all_leave_dca
                             WHERE all_leave_dca.driver_id = d.id
                               AND all_leave_dca.company_id = $1::uuid
                               AND all_leave_dca.is_authorized = true
                               AND all_leave_dca.deactivated_at IS NULL
                           ))
      WHERE r.operating_company_id = $1::uuid
      ORDER BY r.created_at DESC
      LIMIT $2
      OFFSET $3
    `,
    [operatingCompanyId, limit, offset]
  );
  return { requests: res.rows, totalCount: Number(countRes.rows[0]?.total_count ?? 0) };
}

export async function listDriverLeaveRequests(
  client: QueryableClient,
  operatingCompanyId: string,
  driverId: string,
  limit: number,
  offset: number,
) {
  const scope = [operatingCompanyId, driverId];
  const countRes = await client.query(
    `SELECT COUNT(*)::int AS total_count
     FROM safety.driver_leave_requests r
     WHERE r.operating_company_id = $1::uuid
       AND r.driver_id = $2::uuid`,
    scope,
  );
  const res = await client.query(
    `SELECT r.*,
            mdata.resolve_driver_label_same_company(r.driver_id, r.operating_company_id) AS driver_name
     FROM safety.driver_leave_requests r
     WHERE r.operating_company_id = $1::uuid
       AND r.driver_id = $2::uuid
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT $3::int OFFSET $4::int`,
    [...scope, limit, offset],
  );
  return { requests: res.rows, totalCount: Number(countRes.rows[0]?.total_count ?? 0) };
}

export async function getLeaveRequestDetail(client: QueryableClient, operatingCompanyId: string, requestId: string) {
  const reqRes = await client.query(
    `
      SELECT r.*,
        concat_ws(' ', d.first_name, d.last_name) AS driver_name
      FROM safety.driver_leave_requests r
      JOIN mdata.drivers d ON d.id = r.driver_id
                           AND (d.operating_company_id = $1::uuid OR EXISTS (
                             SELECT 1 FROM mdata.driver_company_authorizations leave_detail_dca
                             WHERE leave_detail_dca.driver_id = d.id
                               AND leave_detail_dca.company_id = $1::uuid
                               AND leave_detail_dca.is_authorized = true
                               AND leave_detail_dca.deactivated_at IS NULL
                           ))
      WHERE r.operating_company_id = $1::uuid AND r.id = $2
      LIMIT 1
    `,
    [operatingCompanyId, requestId]
  );
  const request = reqRes.rows[0] ?? null;
  if (!request) return null;

  const auditRes = await client.query(
    `
      SELECT id, event_type, event_payload, actor_user_id, actor_name, created_at
      FROM safety.driver_leave_audit_log
      WHERE operating_company_id = $1::uuid AND leave_request_id = $2
      ORDER BY id ASC
    `,
    [operatingCompanyId, requestId]
  );

  const daysRes = await client.query(
    `
      SELECT leave_date::text AS leave_date, leave_type
      FROM safety.driver_leave_days
      WHERE operating_company_id = $1::uuid
        AND leave_request_id = $2
        AND voided_at IS NULL
      ORDER BY leave_date ASC
    `,
    [operatingCompanyId, requestId]
  );

  return { request, audit_log: auditRes.rows, leave_days: daysRes.rows };
}

function addUsedForLeaveType(
  leaveType: z.infer<typeof leaveTypeSchema>,
  days: number,
  bal: { vacation_used?: number; sick_used?: number; personal_used?: number }
) {
  if (leaveType === "vacation") return { ...bal, vacation_used: Number(bal.vacation_used ?? 0) + days };
  if (leaveType === "sick") return { ...bal, sick_used: Number(bal.sick_used ?? 0) + days };
  if (leaveType === "personal") return { ...bal, personal_used: Number(bal.personal_used ?? 0) + days };
  return bal;
}

export async function reviewLeaveRequest(
  client: QueryableClient,
  args: {
    operatingCompanyId: string;
    requestId: string;
    actorUserId: string;
    body: z.infer<typeof reviewLeaveRequestSchema>;
  }
) {
  const input = reviewLeaveRequestSchema.parse(args.body);

  const curRes = await client.query(
    `SELECT * FROM safety.driver_leave_requests WHERE operating_company_id = $1::uuid AND id = $2 LIMIT 1`,
    [args.operatingCompanyId, args.requestId]
  );
  const current = curRes.rows[0] ?? null;
  if (!current) return { error: "leave_request_not_found" as const };
  if (String(current.status) !== "pending_review") return { error: "leave_request_not_pending" as const };

  if (input.action === "deny") {
    const res = await client.query(
      `
        UPDATE safety.driver_leave_requests
        SET
          status = 'denied',
          reviewed_by_user_id = $3,
          reviewed_at = now(),
          review_action = 'deny',
          denial_reason = $4
        WHERE operating_company_id = $1::uuid AND id = $2
          AND status = 'pending_review'
          AND voided_at IS NULL
        RETURNING *
      `,
      [args.operatingCompanyId, args.requestId, args.actorUserId, input.denied_reason ?? null]
    );
    const row = res.rows[0];
    if (!row) return { error: "leave_request_not_pending" as const };
    await appendLeaveAudit(client, {
      operatingCompanyId: args.operatingCompanyId,
      leaveRequestId: args.requestId,
      eventType: "leave_request_denied",
      payload: { denied_reason: input.denied_reason ?? null },
      actorUserId: args.actorUserId,
    });
    await enqueueOutbox(client, "driver.scheduler.leave_denied", {
      operating_company_id: args.operatingCompanyId,
      leave_request_id: args.requestId,
      driver_id: row.driver_id,
    });
    return { request: row };
  }

  if (input.action === "defer") {
    const res = await client.query(
      `
        UPDATE safety.driver_leave_requests
        SET
          status = 'deferred',
          reviewed_by_user_id = $3,
          reviewed_at = now(),
          review_action = 'defer',
          modification_reason = $4
        WHERE operating_company_id = $1::uuid AND id = $2
          AND status = 'pending_review'
          AND voided_at IS NULL
        RETURNING *
      `,
      [args.operatingCompanyId, args.requestId, args.actorUserId, input.modification_reason ?? null]
    );
    const row = res.rows[0];
    if (!row) return { error: "leave_request_not_pending" as const };
    await appendLeaveAudit(client, {
      operatingCompanyId: args.operatingCompanyId,
      leaveRequestId: args.requestId,
      eventType: "leave_request_deferred",
      payload: { modification_reason: input.modification_reason ?? null },
      actorUserId: args.actorUserId,
    });
    return { request: row };
  }

  const start =
    input.action === "approve_modified" && input.approved_start_date
      ? input.approved_start_date
      : String(current.start_date).slice(0, 10);
  const end =
    input.action === "approve_modified" && input.approved_end_date ? input.approved_end_date : String(current.end_date).slice(0, 10);

  if (daysInclusive(start, end) < 1) return { error: "leave_invalid_dates" as const };

  if (await hasApprovedOverlap(client, String(current.driver_id), start, end)) {
    return { error: "leave_overlaps_approved" as const };
  }

  const leaveType = leaveTypeSchema.parse(current.leave_type);
  const dayList = enumerateDates(start, end);
  const span = dayList.length;

  const planYear = Number(start.slice(0, 4));
  let bal: Record<string, number> | undefined;
  if (leaveType !== "wfh") {
    await ensureLeaveBalanceRow(client, args.operatingCompanyId, String(current.driver_id), planYear);
    const balRes = await client.query(
      `
        SELECT * FROM catalogs.driver_leave_balances
        WHERE operating_company_id = $1::uuid AND driver_id = $2 AND plan_year = $3
        FOR UPDATE
      `,
      [args.operatingCompanyId, current.driver_id, planYear]
    );
    bal = balRes.rows[0] as Record<string, number> | undefined;
    if (bal) {
      if (leaveType === "vacation" && bal.vacation_used + span > bal.vacation_allocated) {
        return { error: "leave_vacation_balance_exceeded" as const };
      }
      if (leaveType === "sick" && bal.sick_used + span > bal.sick_allocated) {
        return { error: "leave_sick_balance_exceeded" as const };
      }
      if (leaveType === "personal" && bal.personal_used + span > bal.personal_allocated) {
        return { error: "leave_personal_balance_exceeded" as const };
      }
    }
  }

  const reviewAction = input.action === "approve_modified" ? "approve_modified" : "approve";

  const upd = await client.query(
    `
      UPDATE safety.driver_leave_requests
      SET
        status = 'approved',
        approved_start_date = $3::date,
        approved_end_date = $4::date,
        reviewed_by_user_id = $5,
        reviewed_at = now(),
        review_action = $6::text,
        modification_reason = $7
      WHERE operating_company_id = $1::uuid AND id = $2
        AND status = 'pending_review'
        AND voided_at IS NULL
      RETURNING *
    `,
    [
      args.operatingCompanyId,
      args.requestId,
      start,
      end,
      args.actorUserId,
      reviewAction,
      input.modification_reason ?? null,
    ]
  );
  const updated = upd.rows[0];
  if (!updated) return { error: "leave_request_not_pending" as const };

  for (const d of dayList) {
    await client.query(
      `
        INSERT INTO safety.driver_leave_days (
          operating_company_id,
          leave_request_id,
          driver_id,
          leave_date,
          leave_type
        ) VALUES ($1, $2, $3, $4::date, $5)
      `,
      [args.operatingCompanyId, args.requestId, current.driver_id, d, leaveType]
    );
  }

  if (leaveType !== "wfh" && bal) {
    const nextUsed = addUsedForLeaveType(leaveType, span, {
      vacation_used: bal.vacation_used,
      sick_used: bal.sick_used,
      personal_used: bal.personal_used,
    });
    await client.query(
      `
        UPDATE catalogs.driver_leave_balances
        SET
          vacation_used = $3,
          sick_used = $4,
          personal_used = $5,
          updated_at = now()
        WHERE operating_company_id = $1::uuid
          AND driver_id = $2
          AND plan_year = $6
      `,
      [
        args.operatingCompanyId,
        current.driver_id,
        nextUsed.vacation_used ?? bal.vacation_used ?? 0,
        nextUsed.sick_used ?? bal.sick_used ?? 0,
        nextUsed.personal_used ?? bal.personal_used ?? 0,
        planYear,
      ]
    );
  }

  await appendLeaveAudit(client, {
    operatingCompanyId: args.operatingCompanyId,
    leaveRequestId: args.requestId,
    eventType: "leave_request_approved",
    payload: { approved_start_date: start, approved_end_date: end, days: span, review_action: reviewAction },
    actorUserId: args.actorUserId,
  });

  await enqueueOutbox(client, "driver.scheduler.leave_approved", {
    operating_company_id: args.operatingCompanyId,
    leave_request_id: args.requestId,
    driver_id: current.driver_id,
  });

  return { request: updated };
}

export async function getFleetSchedule(
  client: QueryableClient,
  args: { operatingCompanyId: string; startDate: string; endDate: string }
) {
  // DRIVERHUB-3: canonical active-load status set for "the driver's current tractor".
  const activeStatusList = DISPATCH_ACTIVE_LOAD_STATUSES.map((s) => `'${s}'`).join(", ");
  const driversRes = await client.query(
    `
      SELECT
        d.id AS driver_id,
        concat_ws(' ', d.first_name, d.last_name) AS driver_name,
        d.status::text AS driver_status,
        u.id AS unit_id,
        u.unit_number,
        lah.last_activity_at AS last_dispatch_activity_at
      FROM mdata.drivers d
      -- DRIVERHUB-3: the CURRENT tractor for a driver is the unit assigned on their most-recent ACTIVE
      -- dispatch load (mdata.loads.assigned_unit_id where assigned_primary_driver_id = d.id), NOT the
      -- unpopulated mdata.units.assigned_driver_id column (always NULL in prod → the Unit cell was blank).
      LEFT JOIN LATERAL (
        SELECT l.assigned_unit_id
        FROM mdata.loads l
        WHERE l.assigned_primary_driver_id = d.id
          AND l.operating_company_id = $1::uuid
          AND l.soft_deleted_at IS NULL
          AND l.assigned_unit_id IS NOT NULL
          AND l.status::text IN (${activeStatusList})
        ORDER BY l.created_at DESC
        LIMIT 1
      ) al ON TRUE
      LEFT JOIN mdata.units u
        ON u.id = al.assigned_unit_id
        AND u.deactivated_at IS NULL
        AND (u.owner_company_id = $1 OR u.currently_leased_to_company_id = $1)
      -- ROUND 16.19: "why is/isn't a driver active" — the most recent dispatch assignment event
      -- that TOUCHED this driver, either side (assigned onto a load, or taken off one).
      -- dispatch.load_assignment_history is the real assignment audit trail (verified live on
      -- Neon prod: 154 rows, 77 with new_driver_id set); a computed MAX(), not a new column —
      -- CC-2 cannot author migrations and this needs none.
      LEFT JOIN LATERAL (
        SELECT MAX(lah_row.assigned_at) AS last_activity_at
        FROM dispatch.load_assignment_history lah_row
        WHERE lah_row.operating_company_id = $1::uuid
          AND (lah_row.new_driver_id = d.id OR lah_row.previous_driver_id = d.id)
      ) lah ON TRUE
      WHERE (
          d.operating_company_id = $1::uuid
          OR EXISTS (
            SELECT 1
            FROM mdata.driver_company_authorizations scheduler_fleet_dca
            WHERE scheduler_fleet_dca.driver_id = d.id
              AND scheduler_fleet_dca.company_id = $1::uuid
              AND scheduler_fleet_dca.is_authorized = true
              AND scheduler_fleet_dca.deactivated_at IS NULL
          )
        )
        AND d.deactivated_at IS NULL
        AND d.status = 'Active'::mdata.driver_status
        -- DRIVERHUB-2: never list non-genuine drivers on the Scheduler. Exclude onboarding sample
        -- rows (is_sample_data) plus DEMO/DUMMY/TEST seed-marker name rows. Read-only filter — the
        -- rows stay in mdata.drivers (void-not-delete), just hidden from the live schedule grid.
        AND d.is_sample_data IS NOT TRUE
        AND concat_ws(' ', d.first_name, d.last_name) NOT ILIKE '%DEMO%'
        AND concat_ws(' ', d.first_name, d.last_name) NOT ILIKE '%DUMMY%'
        AND concat_ws(' ', d.first_name, d.last_name) NOT ILIKE 'TEST%'
      ORDER BY d.last_name, d.first_name
    `,
    [args.operatingCompanyId]
  );

  const daysRes = await client.query(
    `
      SELECT
        ld.driver_id::text AS driver_id,
        ld.leave_date::text AS leave_date,
        ld.leave_type,
        r.status::text AS request_status,
        r.id::text AS leave_request_id
      FROM safety.driver_leave_days ld
      JOIN safety.driver_leave_requests r ON r.id = ld.leave_request_id
      WHERE ld.operating_company_id = $1::uuid
        AND ld.voided_at IS NULL
        AND ld.leave_date BETWEEN $2::date AND $3::date
    `,
    [args.operatingCompanyId, args.startDate, args.endDate]
  );

  const pendingRes = await client.query(
    `
      SELECT
        r.id::text AS id,
        r.driver_id::text AS driver_id,
        r.request_number,
        r.leave_type,
        r.start_date::text AS start_date,
        r.end_date::text AS end_date,
        r.status::text AS status
      FROM safety.driver_leave_requests r
      WHERE r.operating_company_id = $1::uuid
        AND r.status = 'pending_review'
        AND r.voided_at IS NULL
        AND r.end_date >= $2::date
        AND r.start_date <= $3::date
    `,
    [args.operatingCompanyId, args.startDate, args.endDate]
  );

  const vacantRes = await client.query(
    `
      SELECT u.id::text AS unit_id, u.unit_number
      FROM mdata.units u
      WHERE u.deactivated_at IS NULL
        AND u.assigned_driver_id IS NULL
        AND u.status = 'InService'::mdata.unit_status
        -- Entity scope (USMCA cross-entity leak fix): mdata.units has no operating_company_id and
        -- its RLS is identity/role-scoped, so scope the vacant-unit picker by the owner/leased pair.
        AND (u.owner_company_id = $1 OR u.currently_leased_to_company_id = $1)
      ORDER BY u.unit_number, u.id
    `,
    [args.operatingCompanyId]
  );

  return {
    start_date: args.startDate,
    end_date: args.endDate,
    drivers: driversRes.rows,
    leave_day_cells: daysRes.rows,
    pending_requests: pendingRes.rows,
    vacant_units: vacantRes.rows,
  };
}

export async function listTempAssignments(
  client: QueryableClient,
  operatingCompanyId: string,
  filters: { driverId?: string; unitId?: string; limit: number; offset: number },
) {
  // SAFETY-TEMP-COVER-ASSIGNMENTS-ZERO-FE-CALLERS — this used to be SELECT * with no joins (unusable
  // for a UI — raw driver/unit uuids, no names) and operating_company_id compared with no ::uuid
  // cast (the same DA-PROGRAM-ROUTES-500 shape: safety.temp_unit_assignments.operating_company_id is
  // UUID NOT NULL, and node-pg does not reliably infer the placeholder's type under a pooled
  // connection). Both fixed here: join unit/driver names, cast the scope predicate.
  const values = [operatingCompanyId, filters.driverId ?? null, filters.unitId ?? null];
  const countRes = await client.query(
    `
      SELECT COUNT(*)::text AS total_count
      FROM safety.temp_unit_assignments t
      WHERE t.operating_company_id = $1::uuid
        AND t.voided_at IS NULL
        AND ($2::uuid IS NULL OR t.primary_driver_id = $2::uuid OR t.cover_driver_id = $2::uuid)
        AND ($3::uuid IS NULL OR t.unit_id = $3::uuid)
    `,
    values,
  ) as { rows: Array<{ total_count: string }> };
  const res = await client.query(
    `
      SELECT
        t.*,
        u.unit_number,
        pd.first_name || ' ' || pd.last_name AS primary_driver_name,
        cd.first_name || ' ' || cd.last_name AS cover_driver_name
      FROM safety.temp_unit_assignments t
      LEFT JOIN mdata.units u ON u.id = t.unit_id AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = t.operating_company_id
      LEFT JOIN mdata.drivers pd ON pd.id = t.primary_driver_id AND (
        pd.operating_company_id = t.operating_company_id OR EXISTS (
          SELECT 1 FROM mdata.driver_company_authorizations pd_dca
           WHERE pd_dca.driver_id = pd.id
             AND pd_dca.company_id = t.operating_company_id
             AND pd_dca.is_authorized = true
             AND pd_dca.deactivated_at IS NULL
        )
      )
      LEFT JOIN mdata.drivers cd ON cd.id = t.cover_driver_id AND (
        cd.operating_company_id = t.operating_company_id OR EXISTS (
          SELECT 1 FROM mdata.driver_company_authorizations cd_dca
           WHERE cd_dca.driver_id = cd.id
             AND cd_dca.company_id = t.operating_company_id
             AND cd_dca.is_authorized = true
             AND cd_dca.deactivated_at IS NULL
        )
      )
      WHERE t.operating_company_id = $1::uuid
        AND t.voided_at IS NULL
        AND ($2::uuid IS NULL OR t.primary_driver_id = $2::uuid OR t.cover_driver_id = $2::uuid)
        AND ($3::uuid IS NULL OR t.unit_id = $3::uuid)
      ORDER BY t.start_date DESC
      LIMIT $4
      OFFSET $5
    `,
    [...values, filters.limit, filters.offset]
  );
  return { assignments: res.rows, totalCount: Number(countRes.rows[0]?.total_count ?? 0) };
}

export async function assignTempCover(
  client: QueryableClient,
  args: {
    operatingCompanyId: string;
    actorUserId: string;
    body: z.infer<typeof assignTempCoverSchema>;
  }
) {
  const input = assignTempCoverSchema.parse(args.body);
  if (daysInclusive(input.start_date, input.end_date) < 1) {
    return { error: "temp_cover_invalid_dates" as const };
  }
  if (input.primary_driver_id === input.cover_driver_id) {
    return { error: "temp_cover_drivers_must_differ" as const };
  }
  const drivers = await client.query(
    `SELECT id::text
     FROM mdata.drivers
     WHERE operating_company_id = $1::uuid
       AND id = ANY($2::uuid[])
       AND deactivated_at IS NULL`,
    [args.operatingCompanyId, [input.primary_driver_id, input.cover_driver_id]]
  );
  if (new Set(drivers.rows.map((row) => String(row.id))).size !== 2) {
    return { error: "temp_cover_driver_not_found" as const };
  }
  const unit = await client.query(
    `SELECT id::text
     FROM mdata.units
     WHERE id = $2::uuid
       AND COALESCE(currently_leased_to_company_id, owner_company_id) = $1::uuid
       AND deactivated_at IS NULL
     LIMIT 1`,
    [args.operatingCompanyId, input.unit_id]
  );
  if (!unit.rows[0]) return { error: "temp_cover_unit_not_found" as const };
  const ins = await client.query(
    `
      INSERT INTO safety.temp_unit_assignments (
        operating_company_id,
        unit_id,
        primary_driver_id,
        cover_driver_id,
        start_date,
        end_date,
        related_leave_request_id,
        notes,
        created_by_user_id
      ) VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9)
      RETURNING *
    `,
    [
      args.operatingCompanyId,
      input.unit_id,
      input.primary_driver_id,
      input.cover_driver_id,
      input.start_date,
      input.end_date,
      input.related_leave_request_id ?? null,
      input.notes ?? null,
      args.actorUserId,
    ]
  );
  const row = ins.rows[0];
  await appendLeaveAudit(client, {
    operatingCompanyId: args.operatingCompanyId,
    leaveRequestId: input.related_leave_request_id ?? null,
    eventType: "temp_cover_assigned",
    payload: {
      temp_assignment_id: row.id,
      unit_id: input.unit_id,
      cover_driver_id: input.cover_driver_id,
    },
    actorUserId: args.actorUserId,
  });
  await enqueueOutbox(client, "driver.scheduler.temp_cover_assigned", {
    operating_company_id: args.operatingCompanyId,
    temp_assignment_id: row.id,
    cover_driver_id: input.cover_driver_id,
  });
  return { assignment: row };
}

export async function cancelTempCover(
  client: QueryableClient,
  args: {
    operatingCompanyId: string;
    assignmentId: string;
    actorUserId: string;
    reason?: string;
  }
) {
  const res = await client.query(
    `
      UPDATE safety.temp_unit_assignments
      SET
        voided_at = now(),
        voided_by_user_id = $3,
        void_reason = COALESCE($4, 'cancelled')
      WHERE operating_company_id = $1::uuid
        AND id = $2
        AND voided_at IS NULL
      RETURNING *
    `,
    [args.operatingCompanyId, args.assignmentId, args.actorUserId, args.reason ?? null]
  );
  const row = res.rows[0] ?? null;
  if (!row) return null;
  await appendLeaveAudit(client, {
    operatingCompanyId: args.operatingCompanyId,
    eventType: "temp_cover_cancelled",
    payload: { temp_assignment_id: args.assignmentId, reason: args.reason ?? null },
    actorUserId: args.actorUserId,
  });
  return row;
}
