#!/usr/bin/env node
/**
 * DSP-49 (owner order 2026-09-06, "every load carries its pickup and delivery appointments" —
 * live-measured: 49 of 49 open USMCA loads are missing a real appointment_start_at on both the
 * first pickup and the last delivery). This guard locks the fix on BOTH sides of the boundary:
 *
 *   1. FRONTEND (component test, spawned for real -- mirrors verify-driver-pwa-vitest.mjs's
 *      established pattern): the wizard's Book Load §C stops section must actually BLOCK submit
 *      when the first pickup or the last delivery has no appointment, and show the reason.
 *   2. BACKEND (source-scan): book-load.service.ts -- the ONE path every caller of bookLoad()
 *      goes through -- must never trust the client alone; a real booking attempt missing either
 *      appointment must be rejected server-side too.
 *
 * "No backfill of dates you don't have — never invent a time" is enforced by what this guard does
 * NOT check: it never asserts a specific date value, only that an EMPTY appointment is refused.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { maskComments } from "./lib/mask-comments.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-appointments-required-on-book";
const WIZARD = "apps/frontend/src/pages/dispatch/components/BookLoadStopsSection.tsx";
const SERVICE = "apps/backend/src/dispatch/book-load.service.ts";
const APP = join(ROOT, "apps/frontend");
const TEST = "src/pages/dispatch/components/BookLoadStopsSection.appointments.test.tsx";

function read(rel, root = ROOT) {
  return maskComments(readFileSync(join(root, rel), "utf8"));
}

export function collectStaticProblems(root = ROOT) {
  const problems = [];
  let wizardSrc;
  let serviceSrc;
  try {
    wizardSrc = read(WIZARD, root);
  } catch {
    return [`missing ${WIZARD}`];
  }
  try {
    serviceSrc = read(SERVICE, root);
  } catch {
    return [`missing ${SERVICE}`];
  }

  // 1. The wizard actually gates the first pickup and last delivery -- not just any stop, and not
  // a decorative label with no real validation behind it.
  if (!/firstPickupIndex/.test(wizardSrc) || !/lastDeliveryIndex/.test(wizardSrc)) {
    problems.push(`${WIZARD}: must compute firstPickupIndex/lastDeliveryIndex -- the requirement is scoped to the first pickup and last delivery, not every stop`);
  }
  if (!/required:\s*["']Pickup appointment required/.test(wizardSrc)) {
    problems.push(`${WIZARD}: the first pickup's appointment Controller must carry a "required" rule with the reason shown, not a silent optional field`);
  }
  if (!/required:\s*["']Delivery appointment required/.test(wizardSrc)) {
    problems.push(`${WIZARD}: the last delivery's appointment Controller must carry a "required" rule with the reason shown`);
  }
  if (!/data-testid=\{`stop-appointment-error-\$\{index\}`\}/.test(wizardSrc)) {
    problems.push(`${WIZARD}: the validation reason must actually render on screen (fieldState.error), not just exist in the rule`);
  }
  // The wizard's single fixed-time field must also populate appointment_start_at -- the field the
  // rest of the system (Round Trips timeline, LoadStopsRecordTab's own appointmentText()) reads.
  // Without this the "required" gate could pass while the real column stays NULL forever.
  if (!/appointment_start_at`,\s*next \|\| undefined/.test(wizardSrc)) {
    problems.push(`${WIZARD}: setting the appointment date/time must also write appointment_start_at, not only scheduled_arrival_at`);
  }

  // 2. Backend defense-in-depth: bookLoad() must reject a booking whose first pickup or last
  // delivery has no appointment, regardless of what the client sent.
  if (!/pickup_appointment_required/.test(serviceSrc)) {
    problems.push(`${SERVICE}: bookLoad() must reject a missing first-pickup appointment (error "pickup_appointment_required")`);
  }
  if (!/delivery_appointment_required/.test(serviceSrc)) {
    problems.push(`${SERVICE}: bookLoad() must reject a missing last-delivery appointment (error "delivery_appointment_required")`);
  }
  if (!/hasAppointment/.test(serviceSrc)) {
    problems.push(`${SERVICE}: the appointment check must actually run inside bookLoad(), not just exist as dead code`);
  }

  return problems;
}

function fail(messages) {
  console.error(`${LABEL} FAIL:`);
  for (const m of messages) console.error(`  - ${m}`);
  process.exit(1);
}

if (process.argv.includes("--selftest")) {
  const baseline = collectStaticProblems();
  if (baseline.length) fail(baseline);

  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");

  const GOOD_WIZARD = [
    `const firstPickupIndex = 0;`,
    `const lastDeliveryIndex = 1;`,
    `<Controller rules={index === firstPickupIndex ? { required: "Pickup appointment required — this load cannot book without one." } : index === lastDeliveryIndex ? { required: "Delivery appointment required — this load cannot book without one." } : undefined} />`,
    `<p data-testid={\`stop-appointment-error-\${index}\`}>{fieldState.error.message}</p>`,
    `setValue(\`stops.\${index}.appointment_start_at\`, next || undefined, { shouldDirty: true });`,
  ].join("\n");
  const GOOD_SERVICE = [
    `const hasAppointment = (s) => Boolean(s?.scheduled_arrival_at || s?.appointment_start_at);`,
    `if (!hasAppointment(firstPickup)) return { kind: "error", status: 400, payload: { error: "pickup_appointment_required" } };`,
    `if (!hasAppointment(lastDelivery)) return { kind: "error", status: 400, payload: { error: "delivery_appointment_required" } };`,
  ].join("\n");

  const cases = [
    { name: "good fixture", overrides: {}, expectProblems: 0 },
    { name: "wizard: pickup required rule removed (the exact 'gate removed' regression)", overrides: { [WIZARD]: GOOD_WIZARD.replace('required: "Pickup appointment required', 'required: "removed') }, expectProblems: 1 },
    { name: "wizard: delivery required rule removed", overrides: { [WIZARD]: GOOD_WIZARD.replace('required: "Delivery appointment required', 'required: "removed') }, expectProblems: 1 },
    { name: "wizard: error message never rendered on screen", overrides: { [WIZARD]: GOOD_WIZARD.replace('data-testid={`stop-appointment-error-${index}`}', 'data-testid="removed"') }, expectProblems: 1 },
    { name: "wizard: appointment_start_at never written", overrides: { [WIZARD]: GOOD_WIZARD.replace("appointment_start_at`, next || undefined", "removed_field`, next || undefined") }, expectProblems: 1 },
    { name: "backend: pickup check removed", overrides: { [SERVICE]: GOOD_SERVICE.replace("pickup_appointment_required", "removed") }, expectProblems: 1 },
    { name: "backend: delivery check removed", overrides: { [SERVICE]: GOOD_SERVICE.replace("delivery_appointment_required", "removed") }, expectProblems: 1 },
    { name: "backend: hasAppointment check deleted entirely", overrides: { [SERVICE]: `// nothing here` }, expectProblems: 3 },
  ];

  function writeFixture(tmpRoot, overrides) {
    const files = { [WIZARD]: GOOD_WIZARD, [SERVICE]: GOOD_SERVICE, ...overrides };
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(tmpRoot, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
  }

  for (const { name, overrides, expectProblems } of cases) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "appointments-required-guard-"));
    try {
      writeFixture(tmpRoot, overrides);
      const problems = collectStaticProblems(tmpRoot);
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
  const problems = collectStaticProblems();
  if (problems.length > 0) fail(problems);

  // Live: spawn the real component test proving the wizard actually blocks submit -- not just
  // that the rule exists in source, but that it changes real behavior against the real component.
  const r = spawnSync("npx", ["vitest", "run", TEST], { cwd: APP, encoding: "utf8", stdio: "inherit", env: process.env });
  if (r.status !== 0) fail([`frontend vitest (appointment-required component test) exited ${r.status}`]);

  console.log(`${LABEL} OK — wizard blocks Book Load without a first-pickup/last-delivery appointment (frontend + backend), component test green`);
}
