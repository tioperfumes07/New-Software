import { z } from "zod";

/** Generated from mdata.units information_schema dump (2026-06-02). Length 58 editable columns. */
export const UNIT_PATCH_FORBIDDEN_COLUMNS = [
  "id",
  "created_at",
  "updated_at",
  "created_by_user_id",
  "updated_by_user_id",
  "samsara_vehicle_id",
  "status_changed_at",
  "status_changed_by_user_id",
] as const;

export const UNIT_PATCH_OWNER_ONLY_COLUMNS = [
  "sold_price",
  "sold_to",
  "transferred_date",
  "transferred_to_entity",
  "repair_estimate",
  // FLEET-LEASE-08 A) -- same class as sold_to/transferred_to_entity: names the counterparty on a
  // disposal, not just a status flag.
  "repossessed_by_lender",
  "returned_to_lessor_entity",
] as const;

/** All user-patchable mdata.units columns (schema-derived, excludes forbidden system cols). */
export const UNIT_PATCHABLE_FIELD_KEYS = [
  "unit_number",
  "vin",
  "make",
  "model",
  "year",
  "license_plate",
  "license_state",
  "status",
  "assigned_driver_id",
  "acquired_date",
  "disposed_date",
  "notes",
  "deactivated_at",
  "owner_company_id",
  "currently_leased_to_company_id",
  // ROUND 16.19 (owner directive) — FLEET-VISIBILITY-F4583-SAMPLE-DATA-GAP's sibling: mdata.units
  // never exposed is_sample_data as PATCHable at all (mdata.vendors already does, FAC-10's real
  // quarantine path). A fixture unit's ONLY way to be marked is_sample_data=true was a raw ops
  // script — this closes the gap so quarantine goes through the same audited PATCH every other
  // unit field uses (appendCrudAudit / buildPatchChanges), never a bare UPDATE.
  "is_sample_data",
  "is_dispatch_blocked",
  "dispatch_block_reason",
  "dispatch_block_source_uuid",
  "dispatch_block_source_type",
  "is_oos",
  "qbo_class_id",
  "oos_since",
  "oos_reason",
  "oos_location",
  "qbo_vendor_id",
  "status_change_reason",
  "sold_date",
  "sold_to",
  "sold_price",
  "transferred_date",
  "transferred_to_entity",
  "damage_date",
  "damage_description",
  "repair_estimate",
  "repossessed_date",
  "repossessed_by_lender",
  "repossessed_notes",
  "returned_to_lessor_date",
  "returned_to_lessor_entity",
  "returned_to_lessor_notes",
  "oos_date",
  "quick_availability",
  "texas_irp_number",
  "irp_account_number",
  "irp_registered_jurisdictions",
  "irp_expiration",
  "irp_registered_weight_lbs",
  "operation_country",
  "sct_permit_number",
  "sct_permit_expiration",
  "pita_status",
  "pita_permit_number",
  "pita_expiration",
  "ctpat_status",
  "oea_status",
  "hazmat_endorsement",
  "us_insurance_policy_number",
  "us_insurance_carrier",
  "us_insurance_expiration",
  "mx_insurance_policy_number",
  "mx_insurance_carrier",
  "mx_insurance_expiration",
  "title_status",
  "lien_holder",
] as const;

export type UnitPatchableFieldKey = (typeof UNIT_PATCHABLE_FIELD_KEYS)[number];

export const unitStatusSchema = z.enum([
  "InService",
  "OutOfService",
  "InMaintenance",
  "Sold",
  "Damaged",
  "Transferred",
  // FLEET-LEASE-08 A) -- repossession and return-to-lessor are neither a sale (no proceeds
  // existed) nor an intercompany transfer. Distinct disposal classes; do not overload either.
  "Repossessed",
  "ReturnedToLessor",
]);

const quickAvailabilitySchema = z.enum(["available", "booked", "holding"]).nullable();
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const fieldSchemas: Record<UnitPatchableFieldKey, z.ZodTypeAny> = {
  unit_number: z.string().trim().min(1).max(100),
  vin: z.string().trim().min(1).max(100),
  make: z.string().trim().max(100).nullable(),
  model: z.string().trim().max(100).nullable(),
  year: z.number().int().min(1980).max(2100).nullable(),
  license_plate: z.string().trim().max(50).nullable(),
  license_state: z.string().trim().max(50).nullable(),
  status: unitStatusSchema,
  assigned_driver_id: z.string().uuid().nullable(),
  acquired_date: isoDateSchema.nullable(),
  disposed_date: isoDateSchema.nullable(),
  notes: z.string().trim().max(2000).nullable(),
  deactivated_at: isoDateSchema.nullable(),
  owner_company_id: z.string().uuid(),
  currently_leased_to_company_id: z.string().uuid().nullable(),
  is_sample_data: z.boolean(),
  is_dispatch_blocked: z.boolean(),
  dispatch_block_reason: z.string().trim().max(2000).nullable(),
  dispatch_block_source_uuid: z.string().uuid().nullable(),
  dispatch_block_source_type: z.string().trim().max(120).nullable(),
  is_oos: z.boolean(),
  qbo_class_id: z.string().trim().max(120).nullable(),
  oos_since: z.string().nullable(),
  oos_reason: z.string().trim().max(2000).nullable(),
  oos_location: z.string().trim().max(200).nullable(),
  qbo_vendor_id: z.string().trim().max(120).nullable(),
  status_change_reason: z.string().trim().max(2000).nullable(),
  sold_date: isoDateSchema.nullable(),
  sold_to: z.string().trim().max(200).nullable(),
  sold_price: z.number().nonnegative().nullable(),
  transferred_date: isoDateSchema.nullable(),
  transferred_to_entity: z.enum(["TRK", "TRANSP", "USMCA"]).nullable(),
  damage_date: isoDateSchema.nullable(),
  damage_description: z.string().trim().max(4000).nullable(),
  repair_estimate: z.number().nonnegative().nullable(),
  repossessed_date: isoDateSchema.nullable(),
  repossessed_by_lender: z.string().trim().max(200).nullable(),
  repossessed_notes: z.string().trim().max(4000).nullable(),
  returned_to_lessor_date: isoDateSchema.nullable(),
  returned_to_lessor_entity: z.string().trim().max(200).nullable(),
  returned_to_lessor_notes: z.string().trim().max(4000).nullable(),
  oos_date: isoDateSchema.nullable(),
  quick_availability: quickAvailabilitySchema,
  texas_irp_number: z.string().trim().max(120).nullable(),
  irp_account_number: z.string().trim().max(120).nullable(),
  irp_registered_jurisdictions: z.record(z.string(), z.unknown()).nullable(),
  irp_expiration: isoDateSchema.nullable(),
  irp_registered_weight_lbs: z.number().int().nonnegative().nullable(),
  operation_country: z.enum(["US", "MX", "cross_border"]).nullable(),
  sct_permit_number: z.string().trim().max(120).nullable(),
  sct_permit_expiration: isoDateSchema.nullable(),
  pita_status: z.string().trim().max(120).nullable(),
  pita_permit_number: z.string().trim().max(120).nullable(),
  pita_expiration: isoDateSchema.nullable(),
  ctpat_status: z.string().trim().max(120).nullable(),
  oea_status: z.string().trim().max(120).nullable(),
  hazmat_endorsement: z.boolean(),
  us_insurance_policy_number: z.string().trim().max(120).nullable(),
  us_insurance_carrier: z.string().trim().max(200).nullable(),
  us_insurance_expiration: isoDateSchema.nullable(),
  mx_insurance_policy_number: z.string().trim().max(120).nullable(),
  mx_insurance_carrier: z.string().trim().max(200).nullable(),
  mx_insurance_expiration: isoDateSchema.nullable(),
  title_status: z.enum(["owned", "financed", "leased"]).nullable(),
  lien_holder: z.string().trim().max(200).nullable(),
};

const optionalFieldSchemas = Object.fromEntries(
  UNIT_PATCHABLE_FIELD_KEYS.map((key) => [key, fieldSchemas[key].optional()])
) as Record<UnitPatchableFieldKey, z.ZodOptional<z.ZodTypeAny>>;

export const updateUnitBodySchema = z
  .object(optionalFieldSchemas)
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

export function ownerOnlyPatchViolation(role: string, patch: Record<string, unknown>): string | null {
  if (role === "Owner") return null;
  for (const key of UNIT_PATCH_OWNER_ONLY_COLUMNS) {
    if (key in patch) return key;
  }
  return null;
}

export function applyUnitPatchFields(b: z.infer<typeof updateUnitBodySchema>, add: (col: string, val: unknown) => void) {
  for (const key of UNIT_PATCHABLE_FIELD_KEYS) {
    if (key in b) {
      add(key, (b as Record<string, unknown>)[key] ?? null);
    }
  }
}
