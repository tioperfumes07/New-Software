#!/usr/bin/env node
/**
 * verify-locations-list — LST-LOC (Locations list page, read-only)
 *
 * Guard for the Lists → Locations list page. Verifies:
 *  1. Backend route file exists with registerLocationsListRoutes + /api/v1/lists/locations
 *  2. Backend route uses operating_company_id (USMCA predicate)
 *  3. Route is wired in apps/backend/src/index.ts (import + call)
 *  4. Frontend page exists with data-testid, inline filter toolbar, >=5 filter controls, ParityTable, CSV, Print
 *  5. API client function getLocationsList exists
 *  6. Route is wired in apps/frontend/src/routes/manifest.tsx
 *  7. --selftest: poisons the route file (removes company predicate) and page file → guard must FAIL
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-locations-list";

const BACKEND_ROUTE = "apps/backend/src/lists/locations-list.routes.ts";
const BACKEND_INDEX = "apps/backend/src/index.ts";
const FRONTEND_PAGE = "apps/frontend/src/pages/lists/LocationsListPage.tsx";
const FRONTEND_API = "apps/frontend/src/api/lists-locations.ts";
const FRONTEND_MANIFEST = "apps/frontend/src/routes/manifest.tsx";

const FILTER_TESTIDS = [
  "locations-list-filter-search",
  "locations-list-filter-state",
  "locations-list-filter-geocoded",
  "locations-list-filter-geofence",
  "locations-list-filter-source",
];

function assertBackendRoute(src) {
  const errors = [];
  if (!src.includes("registerLocationsListRoutes")) {
    errors.push(`${BACKEND_ROUTE}: must export registerLocationsListRoutes`);
  }
  if (!src.includes("/api/v1/lists/locations")) {
    errors.push(`${BACKEND_ROUTE}: must define GET /api/v1/lists/locations endpoint`);
  }
  if (!src.includes("operating_company_id")) {
    errors.push(`${BACKEND_ROUTE}: must use operating_company_id (USMCA predicate)`);
  }
  if (!src.includes("assertCompanyMembership")) {
    errors.push(`${BACKEND_ROUTE}: must call assertCompanyMembership`);
  }
  if (!src.includes("requireAuth")) {
    errors.push(`${BACKEND_ROUTE}: must call requireAuth`);
  }
  if (!src.includes("withCurrentUser")) {
    errors.push(`${BACKEND_ROUTE}: must use withCurrentUser for scoped DB client`);
  }
  if (!src.includes("set_config('app.operating_company_id'")) {
    errors.push(`${BACKEND_ROUTE}: must set app.operating_company_id via set_config`);
  }
  return errors;
}

function assertBackendIndex(src) {
  const errors = [];
  if (!src.includes("registerLocationsListRoutes")) {
    errors.push(`${BACKEND_INDEX}: must import registerLocationsListRoutes`);
  }
  const importRe = /import\s+\{\s*registerLocationsListRoutes\s*\}\s+from\s+["']\.\/lists\/locations-list\.routes\.js["']/;
  if (!importRe.test(src)) {
    errors.push(`${BACKEND_INDEX}: must import from ./lists/locations-list.routes.js`);
  }
  if (!src.includes("await registerLocationsListRoutes(app)")) {
    errors.push(`${BACKEND_INDEX}: must call await registerLocationsListRoutes(app)`);
  }
  return errors;
}

function assertFrontendPage(src) {
  const errors = [];
  if (!src.includes('data-testid="locations-list-page"')) {
    errors.push(`${FRONTEND_PAGE}: must have data-testid="locations-list-page" on container`);
  }
  if (!src.includes('data-locations-list-filter-toolbar="inline"')) {
    errors.push(`${FRONTEND_PAGE}: must have data-locations-list-filter-toolbar="inline" on filter bar`);
  }
  if (!src.includes("ParityTable")) {
    errors.push(`${FRONTEND_PAGE}: must use ParityTable`);
  }
  if (!src.includes("exportLocationsCsv")) {
    errors.push(`${FRONTEND_PAGE}: must have CSV export function`);
  }
  if (!src.includes("window.print()")) {
    errors.push(`${FRONTEND_PAGE}: must have Print button (window.print)`);
  }
  if (!src.includes("useCompanyContext")) {
    errors.push(`${FRONTEND_PAGE}: must use useCompanyContext for selectedCompanyId`);
  }
  if (!src.includes("useQuery")) {
    errors.push(`${FRONTEND_PAGE}: must use useQuery to fetch data`);
  }
  // Count filter controls by testid
  let filterCount = 0;
  for (const testid of FILTER_TESTIDS) {
    if (src.includes(`data-testid="${testid}"`)) {
      filterCount++;
    }
  }
  if (filterCount < 5) {
    errors.push(`${FRONTEND_PAGE}: must have >=5 filter controls (found ${filterCount}): ${FILTER_TESTIDS.join(", ")}`);
  }
  // Dash-never-zero pattern
  if (!src.includes("\u2014")) {
    errors.push(`${FRONTEND_PAGE}: must use dash-never-zero pattern (\u2014 for null/undefined)`);
  }
  // Read-only: no mutations
  if (/useMutation/.test(src)) {
    errors.push(`${FRONTEND_PAGE}: read-only list page must not use useMutation`);
  }
  return errors;
}

function assertFrontendApi(src) {
  const errors = [];
  if (!src.includes("getLocationsList")) {
    errors.push(`${FRONTEND_API}: must export getLocationsList function`);
  }
  if (!src.includes("LocationRow")) {
    errors.push(`${FRONTEND_API}: must export LocationRow type`);
  }
  if (!src.includes("LocationsListPayload")) {
    errors.push(`${FRONTEND_API}: must export LocationsListPayload type`);
  }
  if (!src.includes("/api/v1/lists/locations")) {
    errors.push(`${FRONTEND_API}: must call /api/v1/lists/locations endpoint`);
  }
  return errors;
}

function assertManifest(src) {
  const errors = [];
  if (!src.includes("LocationsListPage")) {
    errors.push(`${FRONTEND_MANIFEST}: must reference LocationsListPage`);
  }
  if (!src.includes('import("../pages/lists/LocationsListPage"')) {
    errors.push(`${FRONTEND_MANIFEST}: must lazy import from ../pages/lists/LocationsListPage`);
  }
  if (!src.includes('path="/lists/locations"')) {
    errors.push(`${FRONTEND_MANIFEST}: must have route path="/lists/locations"`);
  }
  return errors;
}

function runChecks(backendRouteSrc, backendIndexSrc, frontendPageSrc, frontendApiSrc, manifestSrc) {
  const errors = [
    ...assertBackendRoute(backendRouteSrc),
    ...assertBackendIndex(backendIndexSrc),
    ...assertFrontendPage(frontendPageSrc),
    ...assertFrontendApi(frontendApiSrc),
    ...assertManifest(manifestSrc),
  ];
  return errors;
}

function selftest() {
  // Good fixtures
  const goodBackendRoute = `
    import { withCurrentUser } from "../auth/db.js";
    import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
    import { requireAuth } from "../auth/session-middleware.js";
    export async function registerLocationsListRoutes(app) {
      app.get("/api/v1/lists/locations", async (req, reply) => {
        requireAuth(req, reply);
        assertCompanyMembership(userId, operating_company_id);
        withCurrentUser(userId, async (client) => {
          await client.query("SELECT set_config('app.operating_company_id', $1::text, true)", [operating_company_id]);
        });
      });
    }
  `;
  const goodBackendIndex = `
    import { registerLocationsListRoutes } from "./lists/locations-list.routes.js";
    await registerLocationsListRoutes(app);
  `;
  const goodFrontendPage = `
    import { useQuery } from "@tanstack/react-query";
    import { useCompanyContext } from "../../contexts/CompanyContext";
    import { ParityTable } from "../../components/parity/ParityTable";
    export function LocationsListPage() {
      const { selectedCompanyId } = useCompanyContext();
      useQuery({ queryKey: ["x"] });
      return (
        <div data-testid="locations-list-page">
          <div data-locations-list-filter-toolbar="inline">
            <input data-testid="locations-list-filter-search" />
            <input data-testid="locations-list-filter-state" />
            <select data-testid="locations-list-filter-geocoded" />
            <select data-testid="locations-list-filter-geofence" />
            <select data-testid="locations-list-filter-source" />
          </div>
          <ParityTable />
          <button onClick={() => exportLocationsCsv()}>Export CSV</button>
          <button onClick={() => window.print()}>Print</button>
          <span>{"\u2014"}</span>
        </div>
      );
    }
  `;
  const goodFrontendApi = `
    export type LocationRow = {};
    export type LocationsListPayload = {};
    export async function getLocationsList() {
      return apiRequest("/api/v1/lists/locations");
    }
  `;
  const goodManifest = `
    const LocationsListPage = React.lazy(() => import("../pages/lists/LocationsListPage").then((m) => ({ default: m.LocationsListPage })));
    <Route path="/lists/locations" element={<ProtectedRoute><LocationsListPage /></ProtectedRoute>} />
  `;

  const goodErrors = runChecks(goodBackendRoute, goodBackendIndex, goodFrontendPage, goodFrontendApi, goodManifest);
  if (goodErrors.length) {
    console.error(`${LABEL} --selftest FAIL good fixture:`, goodErrors);
    process.exit(1);
  }

  // Bad fixture: remove operating_company_id from backend route
  const badBackendRoute = goodBackendRoute.replace(/operating_company_id/g, "__PLANTED_DEFECT__");
  const badErrors1 = runChecks(badBackendRoute, goodBackendIndex, goodFrontendPage, goodFrontendApi, goodManifest);
  if (badErrors1.length === 0) {
    console.error(`${LABEL} --selftest FAIL: poisoned backend route (no operating_company_id) should have failed`);
    process.exit(1);
  }

  // Bad fixture: poison frontend page (remove testid + filter toolbar)
  const badFrontendPage = `
    export function LocationsListPage() {
      return <div>No testid, no filters, no table</div>;
    }
  `;
  const badErrors2 = runChecks(goodBackendRoute, goodBackendIndex, badFrontendPage, goodFrontendApi, goodManifest);
  if (badErrors2.length < 3) {
    console.error(`${LABEL} --selftest FAIL: poisoned page should fail hard:`, badErrors2);
    process.exit(1);
  }

  console.log(`${LABEL} --selftest PASS`);
}

function main() {
  if (process.argv.includes("--selftest")) {
    selftest();
    return;
  }

  const backendRouteSrc = fs.readFileSync(path.join(ROOT, BACKEND_ROUTE), "utf8");
  const backendIndexSrc = fs.readFileSync(path.join(ROOT, BACKEND_INDEX), "utf8");
  const frontendPageSrc = fs.readFileSync(path.join(ROOT, FRONTEND_PAGE), "utf8");
  const frontendApiSrc = fs.readFileSync(path.join(ROOT, FRONTEND_API), "utf8");
  const manifestSrc = fs.readFileSync(path.join(ROOT, FRONTEND_MANIFEST), "utf8");

  const errors = runChecks(backendRouteSrc, backendIndexSrc, frontendPageSrc, frontendApiSrc, manifestSrc);
  if (errors.length) {
    console.error(`FAIL ${LABEL}:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`OK ${LABEL}: backend route + frontend page + API client + manifest all wired correctly.`);
}

main();
