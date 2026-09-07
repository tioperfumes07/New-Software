#!/usr/bin/env node
import { readFileSync } from "node:fs";

const route = readFileSync("apps/backend/src/integrations/samsara/samsara-config.routes.ts", "utf8");
const api = readFileSync("apps/frontend/src/api/samsara.ts", "utf8");
const page = readFileSync("apps/frontend/src/pages/integrations/SamsaraIntegrationPage.tsx", "utf8");
const collector = readFileSync("apps/backend/src/integrations/samsara/driver-mirror-collector.ts", "utf8");

function audit(r = route, a = api, p = page, c = collector) {
  return [
    [r.includes('/api/v1/integrations/samsara/drivers'), "entity-scoped roster route"],
    [r.includes('z.enum(["all", "active", "deactivated"])'), "closed status vocabulary"],
    [r.includes("sd.operating_company_id = $1::uuid"), "tenant predicate"],
    [r.includes("sd.driver_activation_status") && r.includes("AS activation_status"), "canonical persisted activation field"],
    [c.includes('readString(raw, "driverActivationStatus", "driver_activation_status")'), "canonical Samsara activation payload mapping"],
    [a.includes("getSamsaraDriverRoster"), "frontend API client"],
    [p.includes('data-testid="samsara-driver-roster"'), "rendered roster"],
    [p.includes('(["active", "deactivated", "all"] as const)') && p.includes("samsara-roster-filter-${status}"), "deactivated filter"],
    [p.includes("<ParityTable"), "shared table"],
    [!c.includes("last_seen_at = now()"), "master collector does not fake movement freshness"],
    [c.includes("'-infinity'::timestamptz"), "unobserved imports fail closed"],
  ].filter(([ok]) => !ok).map(([, label]) => label);
}

const failures = audit();
if (failures.length) { console.error(`FAIL: ${failures.join(", ")}`); process.exit(1); }
if (process.argv.includes("--selftest")) {
  const mutations = [
    [route.replace("sd.operating_company_id = $1::uuid", "TRUE"), api, page, collector],
    [route.replace("sd.driver_activation_status", "sd.status"), api, page, collector],
    [route, api, page, collector.replace('readString(raw, "driverActivationStatus", "driver_activation_status")', 'readString(raw, "status")')],
    [route, api, page.replace('["active", "deactivated", "all"]', '["active", "all"]'), collector],
    [route, api, page, collector.replace("'-infinity'::timestamptz", "now()")],
  ];
  for (const args of mutations) if (audit(...args).length === 0) { console.error("SELFTEST FAIL"); process.exit(1); }
  console.log("verify-samsara-roster-status-filter selftest PASS 3/3");
}
console.log("verify-samsara-roster-status-filter PASS");
