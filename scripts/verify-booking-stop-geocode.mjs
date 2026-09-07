#!/usr/bin/env node
// D5 (STANDING-DIRECTIVES-2026-09-05.md, "D5 Book Load auto-geofence FE trigger", owner ruling
// 2026-09-05, own-worktree order): the genuine gap behind "0 of 114 stops have lat/lng" was
// telematics/auto-geofence.service.ts's geocodeStopIfNeeded() being a literal stub. This guard
// pins the full fix, source-scan, comments masked:
//   1. a real geocode util exists, reusing the SAME Trimble/Google provider chain already built
//      for the address-search field (never inventing a second integration).
//   2. auto-geofence.service.ts's stub now calls it (self-heals every future booking).
//   3. a tenant-scoped on-demand endpoint exists to backfill an already-booked load's stops.
//   4. the frontend actually calls that endpoint from a visible control (not a dead client fn).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { maskComments } from "./lib/mask-comments.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-booking-stop-geocode";
const FALLBACK_SERVICE = "apps/backend/src/telematics/stop-geocode-fallback.service.ts";
const AUTO_GEOFENCE = "apps/backend/src/telematics/auto-geofence.service.ts";
const ROUTES = "apps/backend/src/dispatch/loads.routes.ts";
const API_CLIENT = "apps/frontend/src/api/dispatch.ts";
const DRAWER = "apps/frontend/src/components/dispatch/LoadDetailDrawer.tsx";

function read(rel, root = ROOT) {
  return maskComments(readFileSync(join(root, rel), "utf8"));
}

export function collectProblems(root = ROOT) {
  const problems = [];
  const files = {};
  for (const [key, rel] of Object.entries({
    fallback: FALLBACK_SERVICE,
    autoGeofence: AUTO_GEOFENCE,
    routes: ROUTES,
    apiClient: API_CLIENT,
    drawer: DRAWER,
  })) {
    try {
      files[key] = read(rel, root);
    } catch {
      problems.push(`missing ${rel}`);
    }
  }
  if (problems.length) return problems;
  const { fallback, autoGeofence, routes, apiClient, drawer } = files;

  // 1. The fallback util must reuse the existing provider chain, never invent a new one.
  if (!/from ["']\.\.\/integrations\/trimble\/trimble-maps-client\.js["']/.test(fallback) || !/singleSearchGeocode/.test(fallback)) {
    problems.push(`${FALLBACK_SERVICE}: must reuse trimble-maps-client's singleSearchGeocode, not a new integration`);
  }
  if (!/from ["']\.\.\/integrations\/google\/google-places-client\.js["']/.test(fallback) || !/searchAddress/.test(fallback)) {
    problems.push(`${FALLBACK_SERVICE}: must reuse google-places-client's searchAddress as the fallback provider`);
  }
  if (!/export async function geocodeAddress/.test(fallback)) {
    problems.push(`${FALLBACK_SERVICE}: must export geocodeAddress(address) -> LatLng | null`);
  }
  if (!/export async function backfillStopCoordinatesForLoad/.test(fallback)) {
    problems.push(`${FALLBACK_SERVICE}: must export backfillStopCoordinatesForLoad(client, operatingCompanyId, loadId)`);
  }
  // Non-blocking by construction: a provider failure must degrade to null, never throw out of
  // this module (every caller already treats "no coordinates" as legitimate state).
  // RG-08 — geocodeAddress evolved into a thin wrapper over geocodeAddressWithEvidence (the
  // evidence-preserving variant durable backfills use), whose own `catch (error) { return
  // {ok:false, reason: stableProviderFailureReason(error)} }` is a BOUND catch clause (captures
  // the error to classify WHY it failed) — a real improvement over a bare `catch {}`, not a
  // regression. The old regex only matched a bare `catch {`, never `catch (error) {`, so it
  // false-failed on the better code. Accept an optional parenthesized binding.
  if (!/catch\s*(?:\([^)]*\))?\s*\{\s*\n?\s*\/\//.test(fallback) && !/catch\s*(?:\([^)]*\))?\s*\{\s*return/.test(fallback)) {
    problems.push(`${FALLBACK_SERVICE}: geocodeAddress must catch provider failures and return null, never throw`);
  }

  // 2. The stub is gone; the real service is wired in. (Comments are masked before this check
  // runs, so the old stub's prose can't be matched directly — the code shape is: does
  // geocodeStopIfNeeded actually call the real geocoder, at all.)
  if (!/from ["']\.\/stop-geocode-fallback\.service\.js["']/.test(autoGeofence) || !/geocodeAddress\(stop\)/.test(autoGeofence)) {
    problems.push(`${AUTO_GEOFENCE}: geocodeStopIfNeeded must call geocodeAddress(stop) from stop-geocode-fallback.service.js — the pre-fix stub always returned null`);
  }

  // 3. Tenant-scoped on-demand backfill endpoint.
  if (!/app\.post\(\s*"\/api\/v1\/dispatch\/loads\/:id\/geocode-stops"/.test(routes)) {
    problems.push(`${ROUTES}: missing POST /api/v1/dispatch/loads/:id/geocode-stops route`);
  }
  if (!/geocode-stops[\s\S]{0,600}withCompanyScope/.test(routes)) {
    problems.push(`${ROUTES}: the geocode-stops route must read/write through withCompanyScope (tenant-scoped)`);
  }
  if (!/backfillStopCoordinatesForLoad/.test(routes)) {
    problems.push(`${ROUTES}: the geocode-stops route must call backfillStopCoordinatesForLoad`);
  }

  // 4. Frontend actually calls it from a visible control.
  if (!/\/api\/v1\/dispatch\/loads\/\$\{id\}\/geocode-stops/.test(apiClient)) {
    problems.push(`${API_CLIENT}: missing a client function calling POST .../loads/:id/geocode-stops`);
  }
  if (!/geocodeDispatchLoadStops/.test(drawer)) {
    problems.push(`${DRAWER}: must call geocodeDispatchLoadStops (a client function with no caller is not a wired trigger)`);
  }
  if (!/data-testid="load-detail-geocode-stops-button"/.test(drawer)) {
    problems.push(`${DRAWER}: must render a geocode-stops button (data-testid="load-detail-geocode-stops-button") the user can actually click`);
  }

  return problems;
}

function fail(messages) {
  console.error(`${LABEL} FAIL:`);
  for (const m of messages) console.error(`  - ${m}`);
  process.exit(1);
}

if (process.argv.includes("--selftest")) {
  const baseline = collectProblems();
  if (baseline.length) fail(baseline);

  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");

  const GOOD = {
    [FALLBACK_SERVICE]: [
      `import { singleSearchGeocode } from "../integrations/trimble/trimble-maps-client.js";`,
      `import { searchAddress } from "../integrations/google/google-places-client.js";`,
      `export async function geocodeAddress(address) {`,
      `  try {`,
      `    return null;`,
      `  } catch {`,
      `    // never throw`,
      `    return null;`,
      `  }`,
      `}`,
      `export async function backfillStopCoordinatesForLoad(client, operatingCompanyId, loadId) {}`,
    ].join("\n"),
    [AUTO_GEOFENCE]: [
      `import { geocodeAddress } from "./stop-geocode-fallback.service.js";`,
      `async function geocodeStopIfNeeded(stop) { return geocodeAddress(stop); }`,
    ].join("\n"),
    [ROUTES]: [
      `import { backfillStopCoordinatesForLoad } from "../telematics/stop-geocode-fallback.service.js";`,
      `app.post("/api/v1/dispatch/loads/:id/geocode-stops", {}, async (req, reply) => {`,
      `  const result = await withCompanyScope(authUser.uuid, operatingCompanyId, async (client) => {`,
      `    return backfillStopCoordinatesForLoad(client, operatingCompanyId, params.data.id);`,
      `  });`,
      `});`,
    ].join("\n"),
    [API_CLIENT]: `export function geocodeDispatchLoadStops(id, operatingCompanyId) { return apiRequest(\`/api/v1/dispatch/loads/\${id}/geocode-stops\`, { method: "POST" }); }`,
    [DRAWER]: [
      `import { geocodeDispatchLoadStops } from "../../api/dispatch";`,
      `function X() {`,
      `  const m = useMutation({ mutationFn: () => geocodeDispatchLoadStops(load.id, load.operating_company_id) });`,
      `  return <button data-testid="load-detail-geocode-stops-button" onClick={() => m.mutate()} />;`,
      `}`,
    ].join("\n"),
  };

  function writeFixture(tmpRoot, overrides = {}) {
    for (const [rel, content] of Object.entries(GOOD)) {
      const full = path.join(tmpRoot, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, overrides[rel] ?? content);
    }
  }

  const cases = [
    { name: "good fixture", overrides: {}, expectProblems: 0 },
    {
      name: "fallback util invents a new provider (no trimble/google reuse)",
      overrides: { [FALLBACK_SERVICE]: `export async function geocodeAddress() { return null; }\nexport async function backfillStopCoordinatesForLoad() {}` },
      expectProblems: 3,
    },
    {
      name: "auto-geofence still the pre-fix stub",
      overrides: {
        [AUTO_GEOFENCE]: [
          `async function geocodeStopIfNeeded(_stop) {`,
          `  // Non-blocking MVP: rely on stop/location coordinates.`,
          `  return null;`,
          `}`,
        ].join("\n"),
      },
      expectProblems: 1,
    },
    {
      name: "route missing",
      overrides: { [ROUTES]: `// nothing here` },
      expectProblems: 3,
    },
    {
      name: "client function exists but drawer never calls it",
      overrides: { [DRAWER]: `// unused` },
      expectProblems: 2,
    },
  ];

  for (const { name, overrides, expectProblems } of cases) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "booking-stop-geocode-guard-"));
    try {
      writeFixture(tmpRoot, overrides);
      const problems = collectProblems(tmpRoot);
      if (problems.length !== expectProblems) {
        console.error(
          `${LABEL} SELFTEST FAIL: case "${name}" expected ${expectProblems} problem(s), got ${problems.length}: ${JSON.stringify(problems)}`
        );
        process.exit(1);
      }
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
  console.log(`${LABEL} SELFTEST OK (${cases.length}/${cases.length} cases)`);
} else {
  const problems = collectProblems();
  if (problems.length > 0) fail(problems);
  console.log(`${LABEL} OK — stop geocode fallback is real (Trimble/Google), wired into auto-geofence's trigger, and has a tenant-scoped on-demand endpoint the FE actually calls`);
}
