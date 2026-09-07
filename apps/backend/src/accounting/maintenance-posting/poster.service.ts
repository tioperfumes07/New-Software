import { withLuciaBypass } from "../../auth/db.js";
import { enqueueTmsBillPushRequested } from "../../qbo/tms-bill-push-chain.service.js";
import { ExpenseCategoryMapResolutionError } from "../expense-category-map/resolver.service.js";
import { PostingEngineError, postSourceTransaction } from "../posting-engine.service.js";
import { isEnabled } from "../../lib/feature-flags/service.js";
import { resolveMdataVendorIdBestEffort, resolveVendorIsSampleDataBestEffort } from "../bills.service.js";
import { CAPITALIZE_REPAIR_THRESHOLD_CENTS, decideRepairBooksTreatment } from "../capitalize-threshold.js";
import { resolveRoleAccount, CoaRoleResolutionError, type CoaRole } from "../coa-roles/resolver.service.js";
import { registerCapitalizedRepairAsFixedAsset } from "../owned-unit-fixed-asset-register.service.js";
import { companyBusinessDate } from "../../lib/company-business-date.js";

// GL-posting kill switch for the maintenance / WO-close bill. The bill (A/P row + lines) is always
// created below, but auto-posting it to the GL is gated PER-ENTITY via lib.feature_flags (isEnabled) —
// exactly like the dedicated bill-gl-draft.routes.ts post path. Resolved per operating_company_id (never
// a global process.env read), so flipping posting on for one entity cannot enable it for another. Flag
// OFF (default) => the bill still exists, GL post is a no-op — matching every other gated poster.
const BILL_GL_POSTING_FLAG_KEY = "BILL_GL_POSTING_ENABLED";

type DbClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[]; rowCount?: number }>;
};

type WorkOrderLineRow = {
  wo_line_uuid: string;
  line_type: string;
  description: string | null;
  amount: string | number | null;
  section: string | null;
  expense_category_uuid: string | null;
  service_item_uuid: string | null;
  part_uuid: string | null;
  labor_rate_uuid: string | null;
  part_location_codes: string[] | null;
};

type ClosePostingInput = {
  operating_company_id: string;
  work_order_id: string;
  actor_user_id: string;
};

type ClosePostingResult = {
  bill_id: string | null;
  bill_action: "created" | "reused" | "skipped_no_vendor" | "skipped_no_lines" | "skipped_already_expensed";
  ledger_posting: "posted" | "already_posted" | "skipped";
  posting_batch_id: string | null;
};

const CLOSED_STATUSES = new Set(["closed", "completed", "voided", "complete", "cancelled"]);

function asAmount(value: string | number | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}


async function detectBillLineAccountColumn(client: DbClient): Promise<"account_id" | "coa_account_id" | null> {
  const cols = await client.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'accounting'
        AND table_name = 'bill_lines'
        AND column_name IN ('account_id', 'coa_account_id')
      ORDER BY CASE column_name WHEN 'account_id' THEN 1 ELSE 2 END
      LIMIT 1
    `
  );
  const col = cols.rows[0]?.column_name;
  if (col === "account_id" || col === "coa_account_id") return col;
  return null;
}

async function listBillLineColumns(client: DbClient): Promise<Set<string>> {
  const res = await client.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'accounting'
        AND table_name = 'bill_lines'
    `
  );
  return new Set(res.rows.map((row) => String(row.column_name)));
}

async function getOrCreateBillForWorkOrder(
  client: DbClient,
  input: ClosePostingInput
): Promise<{ bill_id: string | null; action: "created" | "reused" | "skipped_no_vendor" | "skipped_already_expensed" }> {
  const woRes = await client.query<{
    id: string;
    status: string | null;
    vendor_id: string | null;
    external_vendor_id: string | null;
    unit_id: string | null;
    total_actual_cost: string | number | null;
    display_id: string | null;
  }>(
    `
      SELECT
        id::text,
        status::text,
        vendor_id::text,
        external_vendor_id::text,
        unit_id::text,
        total_actual_cost::text,
        display_id::text
      FROM maintenance.work_orders
      WHERE id = $1::uuid
        AND operating_company_id = $2::uuid
      LIMIT 1
    `,
    [input.work_order_id, input.operating_company_id]
  );
  const wo = woRes.rows[0];
  if (!wo || !CLOSED_STATUSES.has(String(wo.status ?? "").toLowerCase())) {
    return { bill_id: null, action: "skipped_no_vendor" };
  }
  const vendorKey = String(wo.external_vendor_id ?? wo.vendor_id ?? "").trim();
  if (!vendorKey) return { bill_id: null, action: "skipped_no_vendor" };

  // MAINT-F5697-CLASS — a WO created with payment_timing='paid_same_day' already went through
  // autoCreateExpenseFromWO (two-section-service.ts), which stamps linked_work_order_uuid on a real
  // accounting.expenses row for this same cost. WO-close ran unconditionally regardless, creating a
  // SECOND, redundant accounting.bills row for the identical total_actual_cost with hardcoded
  // status='unpaid' — a real A/P liability to a vendor who was already paid in cash at creation
  // time, on top of the cash expense already posted. Mirrors the existing-bill reuse check three
  // lines below (same shape: check for an already-real record before minting a new one).
  const alreadyExpensed = await client.query<{ id: string }>(
    `
      SELECT id::text AS id
      FROM accounting.expenses
      WHERE operating_company_id = $1::uuid
        AND linked_work_order_uuid = $2::uuid
        AND status <> 'void'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.operating_company_id, input.work_order_id]
  );
  if (alreadyExpensed.rows[0]?.id) {
    return { bill_id: null, action: "skipped_already_expensed" };
  }

  const existing = await client.query<{ id: string }>(
    `
      SELECT id::text AS id
      FROM accounting.bills
      WHERE operating_company_id = $1::uuid
        AND linked_work_order_uuid = $2::uuid
        AND revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.operating_company_id, input.work_order_id]
  );
  if (existing.rows[0]?.id) {
    return { bill_id: existing.rows[0].id, action: "reused" };
  }

  const totalAmount = asAmount(wo.total_actual_cost);
  // LV-BILL-MDATA-VENDOR-FK-OPTOUT sweep — vendorKey is a QBO external id OR an mdata.vendors uuid;
  // best-effort resolve the typed FK without blocking WO-close on an unresolvable vendor.
  const mdataVendorId = await resolveMdataVendorIdBestEffort(client, input.operating_company_id, vendorKey);
  // ACCT-F353 — maintenance.work_orders carries no is_sample_data of its own; derive from the same
  // vendor the FK above resolves, matching the relationship every other bill writer in this sweep uses.
  const vendorIsSampleData = await resolveVendorIsSampleDataBestEffort(client, input.operating_company_id, vendorKey);
  // Law §9: stamp unit_id from WO (migration 202607050810). Vendor preserved via vendorKey.
  const billInsert = await client.query<{ id: string }>(
    `
      INSERT INTO accounting.bills (
        operating_company_id,
        vendor_id,
        vendor_uuid,
        mdata_vendor_id,
        linked_work_order_uuid,
        unit_id,
        status,
        bill_date,
        due_date,
        total_amount,
        amount_cents,
        paid_amount,
        paid_cents,
        memo,
        qbo_sync_pending,
        created_by_user_id,
        created_at,
        updated_at,
        -- ACCT-F353 — derived from the vendor being billed (vendorIsSampleData above).
        is_sample_data
      )
      VALUES (
        $1::uuid, $2, $2, $9::uuid, $3::uuid, $8::uuid, 'unpaid', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days',
        $4, $5, 0, 0, $6, true, $7::uuid, now(), now(), $10
      )
      RETURNING id::text
    `,
    [
      input.operating_company_id,
      vendorKey,
      input.work_order_id,
      totalAmount,
      Math.round(totalAmount * 100),
      `Auto-created from work order ${String(wo.display_id ?? input.work_order_id)}`,
      input.actor_user_id,
      wo.unit_id ?? null,
      mdataVendorId,
      vendorIsSampleData,
    ]
  );
  return { bill_id: billInsert.rows[0]?.id ?? null, action: "created" };
}

async function insertBillLinesFromWorkOrder(
  client: DbClient,
  input: ClosePostingInput,
  billId: string
): Promise<{ inserted_count: number }> {
  const woContext = await client.query<{
    wo_type: string | null;
    wo_service_class: string | null;
    description: string | null;
    total_actual_cost: string | number | null;
    unit_id: string | null;
    display_id: string | null;
  }>(
    `
      SELECT wo_type::text, wo_service_class::text, description, total_actual_cost,
             unit_id::text, display_id::text
      FROM maintenance.work_orders
      WHERE id = $1::uuid
        AND operating_company_id = $2::uuid
      LIMIT 1
    `,
    [input.work_order_id, input.operating_company_id]
  );
  const wo = woContext.rows[0] ?? {};

  const lines = await client.query<WorkOrderLineRow>(
    `
      SELECT
        uuid::text AS wo_line_uuid,
        line_type::text,
        description,
        total_cost::text AS amount,
        section::text,
        expense_category_uuid::text,
        service_item_uuid::text,
        part_uuid::text,
        labor_rate_uuid::text,
        part_location_codes
      FROM maintenance.work_order_lines
      WHERE work_order_uuid = $1::uuid
        AND line_type IN ('part', 'parts', 'labor')
        -- MAINT-MONEY-F6797: a voided line must never become a bill line on the WO-close AP bill.
        AND voided_at IS NULL
      ORDER BY created_at ASC
    `,
    [input.work_order_id]
  );
  if (lines.rows.length === 0) return { inserted_count: 0 };

  const existingLinked = await client.query<{ linked_wo_line_uuid: string }>(
    `
      SELECT linked_wo_line_uuid::text
      FROM accounting.bill_lines
      WHERE bill_id = $1::uuid
        AND voided_at IS NULL
        AND linked_wo_line_uuid IS NOT NULL
    `,
    [billId]
  );
  const existingLineIds = new Set(existingLinked.rows.map((row) => String(row.linked_wo_line_uuid)));
  const billLineColumns = await listBillLineColumns(client);
  const accountColumn = await detectBillLineAccountColumn(client);

  // ND-FA-01 / A4-D6 (owner ruling docs/lockdown/GO-19-OWNER-DECISIONS-CLOSED-2026-09-01.md §4,
  // CLOSED at $7,000, NEVER $7,500) — the whole-repair capitalize-vs-expense decision, resolved ONCE
  // per WO-close bill, not per line and not via the maintenance category default. Real defect this
  // fixes: capitalize-threshold.ts's decideRepairBooksTreatment() was never called from this posting
  // path — every WO-close bill line previously posted via the per-category maintenance map regardless
  // of repair size. accountColumn (bill_lines.account_id/coa_account_id) is Tier 1 in
  // resolveBillLineDebitAccount (../bill-account-resolver.ts) — an explicit line account_id always
  // wins over category mapping at GL-posting time, so setting it here is sufficient; no change needed
  // in posting-engine.service.ts. A4-D1: capitalize -> "Fixed Asset – Trucks" (fixed_asset_default
  // role). A4-D2: expense -> "Heavy Repair Expense" (heavy_repair_expense role, live-bound for USMCA
  // at account 6150). Fails closed (CoaRoleResolutionError) if the role is unbound for this entity —
  // never invents/guesses an account.
  let capitalizeAccountId: string | null = null;
  if (accountColumn) {
    const woTotalCents = Math.round(asAmount(wo.total_actual_cost) * 100);
    const treatment = decideRepairBooksTreatment(woTotalCents);
    const role: CoaRole = treatment === "capitalize" ? "fixed_asset_default" : "heavy_repair_expense";
    capitalizeAccountId = await resolveRoleAccount(client, input.operating_company_id, role);

    // ACCT-F26027 -- GUARD-WORKORDERS DEPRECIATION-REGISTER-DEFERRED-VS-NEVER-DEFER. The GL debit
    // above is not the whole fix: a capitalized repair also needs a fixed_assets register row so it
    // enters the depreciation schedule/autopost engine, not just the balance sheet. wo.unit_id is a
    // real FK to mdata.units (trucks/tractors only, 202607230000) -- when absent (no unit on this
    // WO), we fail closed on the register write only, never on the GL posting above.
    if (treatment === "capitalize" && wo.unit_id) {
      await registerCapitalizedRepairAsFixedAsset(client, {
        operating_company_id: input.operating_company_id,
        unit_uuid: wo.unit_id,
        work_order_id: input.work_order_id,
        wo_display_id: wo.display_id ?? null,
        capitalized_amount_cents: woTotalCents,
        purchase_date: companyBusinessDate(),
        actor_user_id: input.actor_user_id,
      });
    }
  }

  const seqRes = await client.query<{ max_line_sequence: number }>(
    `SELECT COALESCE(MAX(line_sequence), 0)::int AS max_line_sequence FROM accounting.bill_lines WHERE bill_id = $1::uuid`,
    [billId]
  );
  let seq = Number(seqRes.rows[0]?.max_line_sequence ?? 0);
  let inserted = 0;

  for (const line of lines.rows) {
    if (existingLineIds.has(line.wo_line_uuid)) continue;
    seq += 1;

    const columns: string[] = ["bill_id", "line_sequence", "amount", "description", "linked_wo_line_uuid"];
    const values: unknown[] = [billId, seq, asAmount(line.amount), line.description ?? null, line.wo_line_uuid];
    if (billLineColumns.has("section")) {
      columns.push("section");
      values.push(line.section ?? "B");
    }
    if (billLineColumns.has("expense_category_uuid")) {
      columns.push("expense_category_uuid");
      values.push(line.expense_category_uuid ?? null);
    }
    if (billLineColumns.has("service_item_uuid")) {
      columns.push("service_item_uuid");
      values.push(line.service_item_uuid ?? null);
    }
    if (billLineColumns.has("part_uuid")) {
      columns.push("part_uuid");
      values.push(line.part_uuid ?? null);
    }
    if (billLineColumns.has("labor_rate_uuid")) {
      columns.push("labor_rate_uuid");
      values.push(line.labor_rate_uuid ?? null);
    }
    if (billLineColumns.has("part_location_codes")) {
      columns.push("part_location_codes");
      values.push(line.part_location_codes ?? null);
    }
    if (accountColumn && capitalizeAccountId) {
      columns.push(accountColumn);
      values.push(capitalizeAccountId);
    }
    const placeholders = values.map((_, idx) => `$${idx + 1}`).join(", ");
    await client.query(`INSERT INTO accounting.bill_lines (${columns.join(", ")}) VALUES (${placeholders})`, values);
    inserted += 1;
  }

  return { inserted_count: inserted };
}

async function recalcBillTotal(client: DbClient, billId: string) {
  const totals = await client.query<{ total_amount: string }>(
    `
      SELECT COALESCE(SUM(amount), 0)::text AS total_amount
      FROM accounting.bill_lines
      WHERE bill_id = $1::uuid
        AND voided_at IS NULL
    `,
    [billId]
  );
  const total = asAmount(totals.rows[0]?.total_amount ?? 0);
  await client.query(
    `
      UPDATE accounting.bills
      SET total_amount = $2,
          amount_cents = $3,
          updated_at = now()
      WHERE id = $1::uuid
    `,
    [billId, total, Math.round(total * 100)]
  );
}

export async function processMaintenanceWorkOrderClose(input: ClosePostingInput): Promise<ClosePostingResult> {
  const dbResult = await withLuciaBypass(async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [input.operating_company_id]);
    // Per-entity GL-posting kill switch. Resolved on the same scoped client the bill is written on, so the
    // flag is evaluated for THIS operating company only. Default OFF => posting_flag_enabled is false and
    // the bill below is created but never posted (no-op).
    const posting_flag_enabled = await isEnabled(client, BILL_GL_POSTING_FLAG_KEY, {
      operating_company_id: input.operating_company_id,
      user_uuid: input.actor_user_id,
    });
    const bill = await getOrCreateBillForWorkOrder(client, input);
    if (!bill.bill_id) {
      return {
        bill_id: null,
        bill_action: bill.action,
        should_post: false,
        posting_flag_enabled,
      };
    }

    const inserted = await insertBillLinesFromWorkOrder(client, input, bill.bill_id);
    if (inserted.inserted_count === 0 && bill.action !== "reused") {
      return {
        bill_id: bill.bill_id,
        bill_action: "skipped_no_lines" as const,
        should_post: false,
        posting_flag_enabled,
      };
    }

    await recalcBillTotal(client, bill.bill_id);
    await enqueueTmsBillPushRequested(client as Parameters<typeof enqueueTmsBillPushRequested>[0], {
      operating_company_id: input.operating_company_id,
      bill_id: bill.bill_id,
      operation: bill.action === "created" ? "create" : "update",
    });
    return {
      bill_id: bill.bill_id,
      bill_action: bill.action,
      should_post: true,
      posting_flag_enabled,
    };
  });

  // Kill switch: even when the bill is post-eligible, do NOT touch the GL unless the per-entity flag is ON.
  if (!dbResult.bill_id || !dbResult.should_post || !dbResult.posting_flag_enabled) {
    return {
      bill_id: dbResult.bill_id,
      bill_action: dbResult.bill_action,
      ledger_posting: "skipped",
      posting_batch_id: null,
    };
  }

  try {
    const posting = await postSourceTransaction(
      {
        operating_company_id: input.operating_company_id,
        source_transaction_type: "bill",
        source_transaction_id: dbResult.bill_id,
      },
      { userId: input.actor_user_id }
    );
    return {
      bill_id: dbResult.bill_id,
      bill_action: dbResult.bill_action,
      ledger_posting: posting.result === "already_posted" ? "already_posted" : "posted",
      posting_batch_id: posting.posting_batch_id,
    };
  } catch (error) {
    // Missing mapping is expected if a maintenance category map has not been configured yet.
    if (error instanceof ExpenseCategoryMapResolutionError) {
      return {
        bill_id: dbResult.bill_id,
        bill_action: dbResult.bill_action,
        ledger_posting: "skipped",
        posting_batch_id: null,
      };
    }
    if (error instanceof PostingEngineError && error.code === "BILL_NOT_POSTING_ELIGIBLE") {
      return {
        bill_id: dbResult.bill_id,
        bill_action: dbResult.bill_action,
        ledger_posting: "skipped",
        posting_batch_id: null,
      };
    }
    throw error;
  }
}
