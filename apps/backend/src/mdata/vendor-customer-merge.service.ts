/**
 * ROUND 16.21 (owner 2026-09-06, verbatim): "I NEED FOR YOU TO RECONCILE VENDORS AND CUSTOMERS,
 * SOME MIGHT BE DUPLICATES OR EVEN TRIPLICATED, ETC, AND MERGE AND CREATE ONE SINGLE VENDOR OF
 * THOSE THAT ARE DUPLICATED OR MORE."
 *
 * mdata.vendors / mdata.customers already carry `is_duplicate` + `merge_target_id` (the schema was
 * designed for this), and reclassify.routes.ts's flag-duplicate endpoints already SET those two
 * columns — but that is a FLAG, not a real merge: it never repoints a single foreign key. This file
 * is the real, audited merge write path that was never built.
 *
 * FK ENUMERATION (live, information_schema, 2026-09-06/07 — re-verify before trusting this comment,
 * schema drifts): every column found to ACTUALLY contain real mdata.vendors.id / mdata.customers.id
 * values (not just name-matched — several "vendor_id"/"customer_id"-named columns turned out to be
 * QBO's own numeric/text id space, not this table's id, confirmed by live sampling before being
 * included or excluded below):
 *
 * VENDOR repoint targets (declared FK + verified loose columns, ALL confirmed live to actually
 * hold mdata.vendors.id values before being listed — several vendor_id-named columns were checked
 * and EXCLUDED because they don't: accounting.bills.vendor_id / accounting.bill_payments.vendor_id
 * / accounting.vendor_balances.vendor_id all hold small QBO-style numeric strings like "1228", not
 * UUIDs — accounting.bills.mdata_vendor_id and accounting.bills.vendor_uuid are the REAL columns
 * for that table, both 100% live-verified, and both are repointed together to stay consistent):
 *   mdata.customers.factoring_company_vendor_id, mdata.loads.factoring_company_vendor_id,
 *   mdata.locations.linked_vendor_id, mdata.unit_border_crossings.customs_broker_id,
 *   mdata.vendor_payment_methods.vendor_id, mdata.maintenance_parts.typical_vendor_id,
 *   catalogs.maintenance_vendors.linked_vendor_id, accounting.banking_rules.then_vendor_id,
 *   accounting.bills.mdata_vendor_id, accounting.bills.vendor_uuid, accounting.expenses.vendor_uuid,
 *   accounting.factoring_advances.factoring_company_vendor_id,
 *   accounting.vendor_classifications.vendor_id, accounting.vendor_credits.vendor_id,
 *   banking.bank_transactions.suggested_vendor_id, catalogs.items.preferred_vendor_id,
 *   factoring.canonical_factor_agreements.factor_vendor_id, fuel.fuel_transactions.vendor_id,
 *   insurance.claim.vendor_id, insurance.policy.vendor_id, maintenance.parts_inventory.vendor_id,
 *   maintenance.parts_invoice_links.vendor_id, maintenance.parts_purchases.vendor_id,
 *   maintenance.warranty_claims.vendor_id, maintenance.work_orders.external_vendor_id,
 *   maintenance.work_orders.roadside_provider_vendor_id, maintenance.work_orders.vendor_id,
 *   safety.integrity_alerts.subject_vendor_id, mdata.vendors.merge_target_id (self-ref chain fixup).
 *
 * CUSTOMER repoint targets (declared FK + verified loose columns):
 *   mdata.customer_contacts.customer_uuid, mdata.customer_lanes.customer_id,
 *   mdata.customer_quality_events.customer_id, mdata.dispatcher_safety_events.related_customer_id,
 *   mdata.loads.customer_id, mdata.locations.linked_customer_id,
 *   accounting.ar_collection_tasks.customer_id, accounting.broker_advances.customer_id,
 *   accounting.credit_memos.customer_id, accounting.customer_classifications.customer_id,
 *   accounting.expense_lines.billable_customer_uuid, accounting.invoices.customer_id,
 *   accounting.invoices.bill_to_entity_id, accounting.lease_contract.lessee_customer_id,
 *   accounting.payments.customer_id, factoring.customer_factor_assignment.customer_id,
 *   insurance.coi_request.customer_id, master_data.customer_relationship_scores.customer_uuid,
 *   safety.complaints.complainant_customer_id, safety.geofence_breach_events.customer_id,
 *   safety.incidents.claimant_customer_id, safety.incidents.responsible_party_customer_id,
 *   shipper_portal.portal_users.customer_id, mdata.customers.merge_target_id (self-ref chain fixup),
 *   mdata.customers.parent_customer_id (self-ref chain fixup).
 *
 * Deliberately excluded: every `views.*` schema entry (derived, not writable — the underlying base
 * table already repointed covers it), and every `*qbo*` column (QBO's own id space, a completely
 * separate system, never this table's uuid — repointing a QBO string id here would be a category
 * error, not a fix).
 */
import { appendCrudAudit } from "../audit/crud-audit.js";

type QueryableClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

const VENDOR_REPOINT_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "mdata.customers", column: "factoring_company_vendor_id" },
  { table: "mdata.loads", column: "factoring_company_vendor_id" },
  { table: "mdata.locations", column: "linked_vendor_id" },
  { table: "mdata.unit_border_crossings", column: "customs_broker_id" },
  { table: "mdata.vendor_payment_methods", column: "vendor_id" },
  { table: "mdata.maintenance_parts", column: "typical_vendor_id" },
  { table: "catalogs.maintenance_vendors", column: "linked_vendor_id" },
  { table: "accounting.banking_rules", column: "then_vendor_id" },
  { table: "accounting.bills", column: "mdata_vendor_id" },
  { table: "accounting.bills", column: "vendor_uuid" },
  { table: "accounting.expenses", column: "vendor_uuid" },
  { table: "accounting.factoring_advances", column: "factoring_company_vendor_id" },
  { table: "accounting.vendor_classifications", column: "vendor_id" },
  { table: "accounting.vendor_credits", column: "vendor_id" },
  { table: "banking.bank_transactions", column: "suggested_vendor_id" },
  { table: "catalogs.items", column: "preferred_vendor_id" },
  { table: "factoring.canonical_factor_agreements", column: "factor_vendor_id" },
  { table: "fuel.fuel_transactions", column: "vendor_id" },
  { table: "insurance.claim", column: "vendor_id" },
  { table: "insurance.policy", column: "vendor_id" },
  { table: "maintenance.parts_inventory", column: "vendor_id" },
  { table: "maintenance.parts_invoice_links", column: "vendor_id" },
  { table: "maintenance.parts_purchases", column: "vendor_id" },
  { table: "maintenance.warranty_claims", column: "vendor_id" },
  { table: "maintenance.work_orders", column: "external_vendor_id" },
  { table: "maintenance.work_orders", column: "roadside_provider_vendor_id" },
  { table: "maintenance.work_orders", column: "vendor_id" },
  { table: "safety.integrity_alerts", column: "subject_vendor_id" },
  { table: "mdata.vendors", column: "merge_target_id" },
];

const CUSTOMER_REPOINT_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "mdata.customer_contacts", column: "customer_uuid" },
  { table: "mdata.customer_lanes", column: "customer_id" },
  { table: "mdata.customer_quality_events", column: "customer_id" },
  { table: "mdata.dispatcher_safety_events", column: "related_customer_id" },
  { table: "mdata.loads", column: "customer_id" },
  { table: "mdata.locations", column: "linked_customer_id" },
  { table: "accounting.ar_collection_tasks", column: "customer_id" },
  { table: "accounting.broker_advances", column: "customer_id" },
  { table: "accounting.credit_memos", column: "customer_id" },
  { table: "accounting.customer_classifications", column: "customer_id" },
  { table: "accounting.expense_lines", column: "billable_customer_uuid" },
  { table: "accounting.invoices", column: "customer_id" },
  { table: "accounting.invoices", column: "bill_to_entity_id" },
  { table: "accounting.lease_contract", column: "lessee_customer_id" },
  { table: "accounting.payments", column: "customer_id" },
  { table: "factoring.customer_factor_assignment", column: "customer_id" },
  { table: "insurance.coi_request", column: "customer_id" },
  { table: "master_data.customer_relationship_scores", column: "customer_uuid" },
  { table: "safety.complaints", column: "complainant_customer_id" },
  { table: "safety.geofence_breach_events", column: "customer_id" },
  { table: "safety.incidents", column: "claimant_customer_id" },
  { table: "safety.incidents", column: "responsible_party_customer_id" },
  { table: "shipper_portal.portal_users", column: "customer_id" },
  { table: "mdata.customers", column: "merge_target_id" },
  { table: "mdata.customers", column: "parent_customer_id" },
];

export type MergeRepointLog = { table: string; column: string; rows_repointed: number };

export type MergeResult = {
  survivor_id: string;
  duplicate_id: string;
  entity: "vendor" | "customer";
  repointed: MergeRepointLog[];
  total_rows_repointed: number;
};

async function repointColumns(
  client: QueryableClient,
  columns: Array<{ table: string; column: string }>,
  survivorId: string,
  duplicateId: string
): Promise<MergeRepointLog[]> {
  const log: MergeRepointLog[] = [];
  for (const { table, column } of columns) {
    // Every column here was live-verified (see the header comment) to hold real ids of the target
    // table's own type — some are `text` columns storing a uuid string, so cast both sides to text
    // for the comparison/assignment rather than assuming uuid on every column.
    const res = await client.query(
      `UPDATE ${table} SET ${column} = $1 WHERE ${column}::text = $2::text`,
      [survivorId, duplicateId]
    );
    const n = res.rowCount ?? 0;
    if (n > 0) log.push({ table, column, rows_repointed: n });
  }
  return log;
}

/**
 * Merges a confirmed-duplicate mdata.vendors row into its survivor: repoints every real FK found
 * live (see VENDOR_REPOINT_COLUMNS), then flags the duplicate row (is_duplicate=true,
 * merge_target_id=survivorId) — the SAME two columns reclassify.routes.ts's existing
 * flag-duplicate endpoint already writes, reused here rather than reinvented. NEVER hard-deletes
 * the duplicate row — quarantine only, per standing law.
 */
export async function mergeVendors(
  client: QueryableClient,
  input: { survivorId: string; duplicateId: string; actorUserId: string; reason: string; operatingCompanyId: string }
): Promise<MergeResult> {
  if (input.survivorId === input.duplicateId) {
    throw new Error("merge_survivor_equals_duplicate");
  }
  const repointed = await repointColumns(client, VENDOR_REPOINT_COLUMNS, input.survivorId, input.duplicateId);

  const flagRes = await client.query(
    `UPDATE mdata.vendors
     SET is_duplicate = true, merge_target_id = $1, updated_at = now()
     WHERE id = $2
     RETURNING id`,
    [input.survivorId, input.duplicateId]
  );
  if (!flagRes.rows.length) throw new Error("vendor_merge_duplicate_not_found");

  const totalRows = repointed.reduce((s, r) => s + r.rows_repointed, 0);

  await appendCrudAudit(client, input.actorUserId, "mdata.vendor.merged", {
    resource_type: "mdata.vendors",
    resource_id: input.duplicateId,
    operating_company_id: input.operatingCompanyId,
    survivor_id: input.survivorId,
    reason: input.reason,
    repointed,
    total_rows_repointed: totalRows,
  }, "info", "ROUND-16.21-VENDOR-CUSTOMER-MERGE");

  await client.query(
    `INSERT INTO mdata.entity_reclassification_log
       (operating_company_id, entity_table, entity_id, action, reason, actor_user_id)
     VALUES ($1::uuid, 'mdata.vendors', $2, 'merge', $3, $4)`,
    [input.operatingCompanyId, input.duplicateId, `merged into ${input.survivorId}: ${input.reason}`, input.actorUserId]
  );

  return { survivor_id: input.survivorId, duplicate_id: input.duplicateId, entity: "vendor", repointed, total_rows_repointed: totalRows };
}

/**
 * Merges a confirmed-duplicate mdata.customers row into its survivor. Same shape as mergeVendors —
 * built for symmetry and real testability (this guard's selftest exercises both), even though
 * ROUND 16.21's live measurement found 0 confirmed customer duplicates to actually run this
 * against (email-based grouping produced false positives across genuinely distinct legal entities
 * — see docs/bus/OUTBOX-CC-1.md for the full reviewed-not-merged list).
 */
export async function mergeCustomers(
  client: QueryableClient,
  input: { survivorId: string; duplicateId: string; actorUserId: string; reason: string; operatingCompanyId: string }
): Promise<MergeResult> {
  if (input.survivorId === input.duplicateId) {
    throw new Error("merge_survivor_equals_duplicate");
  }
  const repointed = await repointColumns(client, CUSTOMER_REPOINT_COLUMNS, input.survivorId, input.duplicateId);

  const flagRes = await client.query(
    `UPDATE mdata.customers
     SET is_duplicate = true, merge_target_id = $1, updated_at = now()
     WHERE id = $2
     RETURNING id`,
    [input.survivorId, input.duplicateId]
  );
  if (!flagRes.rows.length) throw new Error("customer_merge_duplicate_not_found");

  const totalRows = repointed.reduce((s, r) => s + r.rows_repointed, 0);

  await appendCrudAudit(client, input.actorUserId, "mdata.customer.merged", {
    resource_type: "mdata.customers",
    resource_id: input.duplicateId,
    operating_company_id: input.operatingCompanyId,
    survivor_id: input.survivorId,
    reason: input.reason,
    repointed,
    total_rows_repointed: totalRows,
  }, "info", "ROUND-16.21-VENDOR-CUSTOMER-MERGE");

  await client.query(
    `INSERT INTO mdata.entity_reclassification_log
       (operating_company_id, entity_table, entity_id, action, reason, actor_user_id)
     VALUES ($1::uuid, 'mdata.customers', $2, 'merge', $3, $4)`,
    [input.operatingCompanyId, input.duplicateId, `merged into ${input.survivorId}: ${input.reason}`, input.actorUserId]
  );

  return { survivor_id: input.survivorId, duplicate_id: input.duplicateId, entity: "customer", repointed, total_rows_repointed: totalRows };
}
