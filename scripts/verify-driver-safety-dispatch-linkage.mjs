#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function inspect(files) {
  const problems = [];
  const driverBackend = fs.readFileSync(files.driverBackend, "utf8");
  const unitBackend = fs.readFileSync(files.unitBackend, "utf8");
  const driverPage = fs.readFileSync(files.driverPage, "utf8");
  const assignment = fs.readFileSync(files.assignment, "utf8");
  const loads = fs.readFileSync(files.loads, "utf8");
  const safety = fs.readFileSync(files.safety, "utf8");
  const vehicleAssignment = fs.readFileSync(files.vehicleAssignment, "utf8");

  if (!/l\.assigned_unit_id::text AS unit_id[\s\S]*LEFT JOIN mdata\.units u[\s\S]*COALESCE\(u\.currently_leased_to_company_id, u\.owner_company_id\) = l\.operating_company_id/.test(driverBackend)) {
    problems.push("driver aggregate does not join the real dispatch load to its entity-scoped unit");
  }
  if (!/currentTruckRes\.rows\[0\] \?\? loadRes\.rows\[0\]/.test(driverBackend)) {
    problems.push("driver aggregate lacks the dispatch-load fallback when Samsara assignment is absent");
  }
  if (!/d\.id::text AS driver_id[\s\S]*LEFT JOIN mdata\.drivers d[\s\S]*l\.assigned_primary_driver_id/.test(unitBackend)) {
    problems.push("unit aggregate does not join its current load back to the primary driver");
  }
  if (!/!current_driver && current_load\?\.driver_id[\s\S]*source: "dispatch_load"/.test(unitBackend)) {
    problems.push("unit aggregate lacks the dispatch-load driver fallback");
  }
  if (!/kind="driver_safety_profile"[\s\S]*data-testid="driver-profile-safety-file-link"/.test(driverPage)) {
    problems.push("driver profile lacks a canonical EntityLink to the safety file");
  }
  if (!/kind="unit"[\s\S]*data-testid="driver-profile-current-unit-link"/.test(assignment)) {
    problems.push("driver profile current assignment lacks a canonical unit EntityLink");
  }
  if (!/kind="load"[\s\S]*driver-profile-loads-table/.test(loads)) {
    problems.push("driver profile dispatch history lacks canonical load EntityLinks");
  }
  if (!/kind="driver"[\s\S]*id=\{driverId\}/.test(safety)) {
    problems.push("safety profile lacks the reverse canonical driver EntityLink");
  }
  if (!/kind="driver"[\s\S]*data-testid="vehicle-profile-current-driver-link"/.test(vehicleAssignment)) {
    problems.push("unit profile lacks the reverse canonical driver EntityLink");
  }
  return problems;
}

const files = {
  driverBackend: path.join(root, "apps/backend/src/mdata/driver-aggregate.service.ts"),
  unitBackend: path.join(root, "apps/backend/src/mdata/unit-aggregate.service.ts"),
  driverPage: path.join(root, "apps/frontend/src/pages/drivers/DriverProfilePage.tsx"),
  assignment: path.join(root, "apps/frontend/src/components/driver-profile/CurrentAssignmentSection.tsx"),
  loads: path.join(root, "apps/frontend/src/components/driver-profile/LoadsSection.tsx"),
  safety: path.join(root, "apps/frontend/src/components/safety/driver-safety/DriverSafetyProfilePanel.tsx"),
  vehicleAssignment: path.join(root, "apps/frontend/src/components/vehicle-profile/DriverAssignmentSection.tsx"),
};

if (process.argv.includes("--selftest")) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "driver-linkage-"));
  const fixture = {};
  for (const [key, source] of Object.entries(files)) {
    fixture[key] = path.join(dir, `${key}.txt`);
    fs.copyFileSync(source, fixture[key]);
  }
  const mutations = [
    ["driverBackend", "l.assigned_unit_id::text AS unit_id", "NULL::text AS unit_id"],
    ["driverBackend", "currentTruckRes.rows[0] ?? loadRes.rows[0]", "currentTruckRes.rows[0]"],
    ["unitBackend", "source: \"dispatch_load\"", "source: \"unknown\""],
    ["driverPage", "kind=\"driver_safety_profile\"", "kind=\"driver\""],
    ["assignment", "data-testid=\"driver-profile-current-unit-link\"", "data-testid=\"missing\""],
    ["vehicleAssignment", "data-testid=\"vehicle-profile-current-driver-link\"", "data-testid=\"missing\""],
  ];
  let caught = 0;
  for (const [key, before, after] of mutations) {
    const original = fs.readFileSync(fixture[key], "utf8");
    fs.writeFileSync(fixture[key], original.replace(before, after));
    if (inspect(fixture).length > 0) caught += 1;
    fs.writeFileSync(fixture[key], original);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  if (caught !== mutations.length || inspect(files).length > 0) {
    console.error(`verify-driver-safety-dispatch-linkage SELFTEST FAIL — caught ${caught}/${mutations.length}`);
    process.exit(1);
  }
  console.log(`verify-driver-safety-dispatch-linkage SELFTEST PASS — ${caught}/${mutations.length} planted linkage breaks caught`);
  process.exit(0);
}

const problems = inspect(files);
if (problems.length) {
  for (const problem of problems) console.error(`FAIL: ${problem}`);
  process.exit(1);
}
console.log("verify-driver-safety-dispatch-linkage PASS — driver↔unit, driver↔dispatch, and driver↔safety are canonical EntityLinks with entity-scoped backend joins");
