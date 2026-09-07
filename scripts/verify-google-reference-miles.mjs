#!/usr/bin/env node
// DSP-48 (owner ruling 2026-09-05, "LAW §2 row: Google distance = REFERENCE ONLY"). This guard
// enforces the one thing that actually matters about this feature: the reference path can NEVER
// touch a real money-adjacent miles field. Source-scan, comments masked.
//
// DSP-48b (owner ruling 2026-09-05) adds the backend persistence half: legs are now actually
// upserted into mdata.load_stop_legs on save, INCLUDING the new "empty" leg_kind (yard -> first
// pickup). Two things landed elsewhere WHILE this task was in flight, so this guard defers to
// them rather than re-building or re-checking either:
//   - The frontend wizard-wiring half (the grey reference lines under Practical/Short/Empty, for
//     BOTH the practical route and the Empty leg) was already shipped by PR #20801 (LDT-1,
//     GLB-13526) — its own guard (verify-ldt-1-costs-cards.mjs, step 8056) locks it.
//   - The yard's canonical coordinate source (mdata/yard-location.service.ts's
//     getYardBiasCoordinates(), warmed from the real mdata.locations is_ih35_yard row) shipped
//     via Codex's TEL-42 (#20804) — its own guard (verify-yard-location-and-fence.mjs) locks the
//     live-DB half. This guard only asserts THIS service actually calls it, never a second
//     hardcoded coordinate of its own.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { maskComments } from "./lib/mask-comments.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-google-reference-miles";

const SERVICE_FILE = "apps/backend/src/dispatch/google-reference-miles.service.ts";
const REFERENCE_FILES = [
  "apps/backend/src/integrations/google/routes-api-client.ts",
  "apps/backend/src/integrations/google/route-reference.routes.ts",
  SERVICE_FILE,
];
const MILES_STRIP = "apps/frontend/src/pages/dispatch/components/book-load-v4/MilesStrip.tsx";
const CRON = "apps/backend/src/cron/google-reference-miles-expiry-cron.ts";
const INDEX = "apps/backend/src/index.ts";

// The exact fields a reference path must never write.
const FORBIDDEN_MONEY_FIELDS = ["miles_practical", "miles_shortest", "driver_pay", "linehaul", "rate_per_mile", "ratePerMile", "settlement"];

// DSP-48b — this service must never reintroduce its own hardcoded yard coordinate now that
// TEL-42's getYardBiasCoordinates() exists. Digit-bounded (no leading/trailing digit) so a
// coincidentally-similar-but-different number elsewhere never false-positives.
const YARD_COORD_TOKENS = [/(?<!\d)27\.65149(?!\d)/, /(?<!\d)99\.63094(?!\d)/];

function read(rel, root = ROOT) {
  return maskComments(readFileSync(join(root, rel), "utf8"));
}

export function collectProblems(root = ROOT) {
  const problems = [];
  const files = {};
  for (const rel of [...REFERENCE_FILES, MILES_STRIP, CRON, INDEX]) {
    try {
      files[rel] = read(rel, root);
    } catch {
      problems.push(`missing ${rel}`);
    }
  }
  if (problems.length) return problems;

  // 1. The reference path (backend) never writes a money-adjacent miles/pay field.
  for (const rel of REFERENCE_FILES) {
    const src = files[rel];
    for (const field of FORBIDDEN_MONEY_FIELDS) {
      if (src.includes(field)) {
        problems.push(`${rel}: must never reference "${field}" — the Google reference path is comparison-only (LAW §2), never money`);
      }
    }
  }

  // 2. The wizard's display of the reference figure is read-only: no onChange/input wired to it,
  // and the money-field names above never appear anywhere near the googleReferencePractical
  // render block.
  const stripSrc = files[MILES_STRIP];
  if (!/googleReferencePractical/.test(stripSrc)) {
    problems.push(`${MILES_STRIP}: must accept a googleReferencePractical prop and render it — reference miles must actually reach the wizard, not just exist in the backend`);
  }
  const blockMatch = stripSrc.match(/\{googleReferencePractical \? \(([\s\S]*?)\) : null\}/);
  if (!blockMatch) {
    problems.push(`${MILES_STRIP}: googleReferencePractical must be rendered as a plain conditional block (never a form control)`);
  } else {
    const block = blockMatch[1];
    if (/<input|onChange|onPracticalChange|onShortestChange/.test(block)) {
      problems.push(`${MILES_STRIP}: the Google reference line must be read-only — no <input>, onChange, or miles-mutating handler inside it`);
    }
    for (const field of FORBIDDEN_MONEY_FIELDS) {
      if (block.includes(field)) {
        problems.push(`${MILES_STRIP}: the Google reference render block must never reference "${field}"`);
      }
    }
    if (!/title="Google car routing — reference only"/.test(block)) {
      problems.push(`${MILES_STRIP}: the Google reference line must carry the hover label "Google car routing — reference only"`);
    }
  }

  // 2b. DSP-48b's own persistence-on-save requirement: the service must upsert BOTH leg_kinds,
  // and the empty leg's origin must come from TEL-42's canonical getYardBiasCoordinates(), never
  // a second hardcoded coordinate of this file's own.
  const serviceSrc = files[SERVICE_FILE];
  if (!/["']empty["']/.test(serviceSrc)) {
    problems.push(`${SERVICE_FILE}: must persist an "empty" leg_kind row (yard -> first pickup) alongside "practical" legs`);
  }
  if (!/getYardBiasCoordinates/.test(serviceSrc)) {
    problems.push(`${SERVICE_FILE}: the empty leg must source its origin from TEL-42's getYardBiasCoordinates(), never a hardcoded coordinate`);
  }
  for (const token of YARD_COORD_TOKENS) {
    if (token.test(serviceSrc)) {
      problems.push(
        `${SERVICE_FILE}: reintroduces a hardcoded yard coordinate ("${token.source}") — this service must call getYardBiasCoordinates() (mdata/yard-location.service.ts, TEL-42), not carry its own`
      );
    }
  }

  // 3. Expiry job exists and is actually registered (a guard file with no wiring proves nothing).
  if (!/export function initializeGoogleReferenceMilesExpiryCron/.test(files[CRON])) {
    problems.push(`${CRON}: must export initializeGoogleReferenceMilesExpiryCron`);
  }
  if (!/expireStaleGoogleReferenceMiles/.test(files[CRON])) {
    problems.push(`${CRON}: must call expireStaleGoogleReferenceMiles`);
  }
  if (!/interval '30 days'/.test(files[SERVICE_FILE])) {
    problems.push(`${SERVICE_FILE}: expiry must be exactly 30 days (Google ToS)`);
  }
  if (!/initializeGoogleReferenceMilesExpiryCron\(app\)/.test(files[INDEX])) {
    problems.push(`${INDEX}: initializeGoogleReferenceMilesExpiryCron must actually be called at boot, not just importable`);
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
    "apps/backend/src/integrations/google/routes-api-client.ts": `export async function computeRouteReference() { return null; }`,
    "apps/backend/src/integrations/google/route-reference.routes.ts": `export async function registerRouteReferenceRoutes() {}`,
    [SERVICE_FILE]: [
      `import { getYardBiasCoordinates } from "../mdata/yard-location.service.js";`,
      `export async function computeAndPersistLoadRouteReference() {`,
      `  await upsertLeg({ legKind: "practical" });`,
      `  const yard = getYardBiasCoordinates();`,
      `  await upsertLeg({ legKind: "empty", from: yard });`,
      `}`,
      `export async function expireStaleGoogleReferenceMiles() { return client.query("WHERE x < now() - interval '30 days'"); }`,
    ].join("\n"),
    [MILES_STRIP]: [
      `export function MilesStrip({ googleReferencePractical = null }) {`,
      `  return (`,
      `    <div>`,
      `      {googleReferencePractical ? (`,
      `        <p title="Google car routing — reference only">Google ref {googleReferencePractical.miles} mi</p>`,
      `      ) : null}`,
      `    </div>`,
      `  );`,
      `}`,
    ].join("\n"),
    [CRON]: [
      `export function initializeGoogleReferenceMilesExpiryCron(app) {`,
      `  expireStaleGoogleReferenceMiles();`,
      `}`,
    ].join("\n"),
    [INDEX]: `initializeGoogleReferenceMilesExpiryCron(app);`,
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
      name: "reference path writes into miles_practical (the exact regression class this guard exists to catch)",
      overrides: {
        [SERVICE_FILE]: [
          `import { getYardBiasCoordinates } from "../mdata/yard-location.service.js";`,
          `export async function computeAndPersistLoadRouteReference(form) {`,
          `  form.setValue("miles_practical", 100);`,
          `  await upsertLeg({ legKind: "practical" });`,
          `  await upsertLeg({ legKind: "empty", from: getYardBiasCoordinates() });`,
          `}`,
          `export async function expireStaleGoogleReferenceMiles() { return client.query("WHERE x < now() - interval '30 days'"); }`,
        ].join("\n"),
      },
      expectProblems: 1,
    },
    {
      name: "wizard renders reference miles inside an editable input",
      overrides: {
        [MILES_STRIP]: [
          `export function MilesStrip({ googleReferencePractical = null }) {`,
          `  return (`,
          `    <div>`,
          `      {googleReferencePractical ? (`,
          `        <input title="Google car routing — reference only" value={googleReferencePractical.miles} onChange={() => {}} />`,
          `      ) : null}`,
          `    </div>`,
          `  );`,
          `}`,
        ].join("\n"),
      },
      expectProblems: 1,
    },
    {
      name: "expiry cron never actually registered at boot",
      overrides: { [INDEX]: `// nothing here` },
      expectProblems: 1,
    },
    {
      name: "wizard prop never wired at all",
      overrides: {
        [MILES_STRIP]: `export function MilesStrip() { return <div />; }`,
      },
      expectProblems: 2,
    },
    {
      name: "empty leg never persisted at all (DSP-48b's own regression class)",
      overrides: {
        [SERVICE_FILE]: [
          `import { getYardBiasCoordinates } from "../mdata/yard-location.service.js";`,
          `const unused = getYardBiasCoordinates;`,
          `export async function computeAndPersistLoadRouteReference() {`,
          `  await upsertLeg({ legKind: "practical" });`,
          `}`,
          `export async function expireStaleGoogleReferenceMiles() { return client.query("WHERE x < now() - interval '30 days'"); }`,
        ].join("\n"),
      },
      expectProblems: 1,
    },
    {
      name: "empty leg reintroduces its own hardcoded coordinate instead of calling getYardBiasCoordinates()",
      overrides: {
        [SERVICE_FILE]: [
          `export async function computeAndPersistLoadRouteReference() {`,
          `  await upsertLeg({ legKind: "practical" });`,
          `  await upsertLeg({ legKind: "empty", from: { lat: 27.65149, lng: -99.63094 } });`,
          `}`,
          `export async function expireStaleGoogleReferenceMiles() { return client.query("WHERE x < now() - interval '30 days'"); }`,
        ].join("\n"),
      },
      // Missing getYardBiasCoordinates usage (1) AND both hardcoded tokens present (2 more).
      expectProblems: 3,
    },
  ];

  for (const { name, overrides, expectProblems } of cases) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "google-reference-miles-guard-"));
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
  console.log(`${LABEL} OK — Google reference miles never touch money fields; the wizard shows them read-only; legs persist on save; the 30-day expiry cron is wired`);
}
