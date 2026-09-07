#!/usr/bin/env node
import { readFileSync } from "node:fs";

const source = readFileSync("apps/backend/src/telematics/vehicle-driver-pairing.routes.ts", "utf8");
const required = [
  "FROM mdata.driver_company_authorizations pairing_history_dca",
  "pairing_history_dca.driver_id = d.id",
  "pairing_history_dca.company_id = $1::uuid",
  "pairing_history_dca.is_authorized = true",
  "pairing_history_dca.deactivated_at IS NULL",
  "a.operating_company_id = $1::uuid",
  "COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = $1::uuid",
  "history_equipment.equipment_number AS trailer_number",
  "COALESCE(\n                 history_equipment.currently_leased_to_company_id,\n                 history_equipment.owner_company_id\n               ) = a.operating_company_id",
];
const failures = (candidate) => required.filter((needle) => !candidate.includes(needle));

if (process.argv.includes("--selftest")) {
  for (const [name, needle, replacement] of [
    ["authorization table", required[0], "FROM mdata.drivers pairing_history_dca"],
    ["driver match", required[1], "pairing_history_dca.driver_id <> d.id"],
    ["company match", required[2], "pairing_history_dca.company_id <> $1::uuid"],
    ["active authorization", required[3], "pairing_history_dca.is_authorized = false"],
    ["non-deactivated authorization", required[4], "pairing_history_dca.deactivated_at IS NOT NULL"],
    ["assignment scope", required[5], "a.operating_company_id <> $1::uuid"],
    ["unit scope", required[6], "COALESCE(u.currently_leased_to_company_id, u.owner_company_id) <> $1::uuid"],
    ["trailer label", required[7], "history_equipment.unit_number AS trailer_number"],
    ["trailer scope", required[8], "history_equipment.operating_company_id = a.operating_company_id"],
  ]) {
    const mutated = name === "assignment scope" ? source.replaceAll(needle, replacement) : source.replace(needle, replacement);
    if (mutated === source) throw new Error(`mutation did not apply: ${name}`);
    if (failures(mutated).length === 0) throw new Error(`mutation escaped: ${name}`);
  }
  console.log("PASS verify-vehicle-driver-history-shared-label --selftest (9/9)");
  process.exit(0);
}

const missing = failures(source);
if (missing.length) {
  console.error(missing.map((item) => `missing ${item}`).join("\n"));
  process.exit(1);
}
console.log("PASS verify-vehicle-driver-history-shared-label");
