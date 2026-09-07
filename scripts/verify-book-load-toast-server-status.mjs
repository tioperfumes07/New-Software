#!/usr/bin/env node
/**
 * GUARD — LV-DISPATCH-TOAST-LIES. The book-load success toast must be derived from the status the SERVER
 * returned, never from the local save-mode the dispatcher clicked.
 *
 * THE DEFECT, live-proven on prod by CC-3 (2026-08-07, USMCA): after `Override & dispatch` on
 * `L-20260806-0008` the UI showed a green **"Load booked and dispatched"**. On prod that load was — and
 * stayed — `assigned_not_dispatched` (`created_at 02:05:48`, `updated_at 02:05:51`, unchanged on re-query).
 * The toast read `saveMode === "draft" ? "Draft saved" : "Load booked and dispatched"`, so it asserted the
 * POST-dispatch outcome from a local variable while the record sat in the PRE-dispatch state.
 *
 * The server never promised dispatch: `book-load.service.ts` writes
 * `save_mode === "draft" ? "draft" : toMdataStatus(input.status)` — `book_dispatch` does NOT force
 * `dispatched`. And the truth was already on the wire (`RETURNING *` → the 201 row carries `status`); the UI
 * simply never read it.
 *
 * WHY IT IS NOT COSMETIC: the override existed to permit dispatch past two DOT blockers (no CDL expiry on
 * file, no DOT medical card). An override audit trail attesting to an action that did not happen is worse
 * than no override at all — that is what a DOT/FMCSA reviewer or an insurer reads.
 *
 * NOT CLAIMED: this is static analysis of one call site plus its helper. It proves the toast is a function
 * of the server status and that no literal re-asserts dispatch from the save mode. It does not prove the
 * rendered string on a live screen — that is the live-verifier lane's job.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-book-load-toast-server-status";
const MODAL = "apps/frontend/src/pages/dispatch/components/BookLoadModalV4.tsx";
const HELPER = "apps/frontend/src/pages/dispatch/components/book-load-toast.ts";
const STOPS_SECTION = "apps/frontend/src/pages/dispatch/components/BookLoadStopsSection.tsx";
const ADDRESS_GEOCODE = "apps/frontend/src/components/dispatch/AddressGeocodeInput.tsx";
const BOOK_SERVICE = "apps/backend/src/dispatch/book-load.service.ts";

/** The exact shape that shipped the lie: a toast whose dispatched-claim is chosen by save mode. */
const SAVEMODE_ASSERTS_DISPATCH =
  /pushToast\(\s*saveMode\s*===\s*["']draft["']\s*\?[^)]*?["'][^"']*dispatched[^"']*["']/i;

export function auditModal(src) {
  const problems = [];

  if (SAVEMODE_ASSERTS_DISPATCH.test(src)) {
    problems.push(
      `${MODAL}: the success toast picks its "dispatched" wording from \`saveMode\`. ` +
        `save_mode "book_dispatch" does NOT force the dispatched status server-side, so this tells a ` +
        `dispatcher a truck is rolling under an audited DOT override while the load can still be ` +
        `assigned_not_dispatched (LV-DISPATCH-TOAST-LIES).`,
    );
  }

  // The toast must be produced by the helper, which is the only place allowed to decide the wording.
  if (!/bookLoadToastMessage\s*\(/.test(src)) {
    problems.push(
      `${MODAL}: the success toast is not built by bookLoadToastMessage(). The wording must be a function ` +
        `of the status the server returned, not of the click that was made.`,
    );
  }

  // CLASS INSTANCE 2 (2026-08-08): the maintenance-advisory branch returns EARLY from the submit handler
  // and its Continue button fired its own hardcoded green toast — "Load booked with maintenance advisory" —
  // that had never seen the response. True, but silent about dispatch: a book_dispatch landing on
  // assigned_not_dispatched still rendered green. Same file, same flow, same shape as the defect above, so
  // the guard has to cover it or the class is only half closed.
  if (/pendingCloseAfterAdvisory/.test(src)) {
    const advisoryToast = src.match(/pendingCloseAfterAdvisory\s*\?[\s\S]{0,1400}?pushToast\(([\s\S]{0,400}?)\)\s*;/);
    if (!advisoryToast) {
      problems.push(
        `${MODAL}: the maintenance-advisory Continue branch no longer has a readable pushToast — refusing to ` +
          `pass vacuously on a path that already shipped this defect once.`,
      );
    } else if (!/bookLoadToastMessage/.test(advisoryToast[1])) {
      problems.push(
        `${MODAL}: the maintenance-advisory Continue toast does not use bookLoadToastMessage(). It fires after ` +
          `an early return, so it must report the status carried over from the response — not a hardcoded ` +
          `"success" (LV-DISPATCH-TOAST-LIES, class instance 2).`,
      );
    }
  }

  // ...and the server status has to actually be read off the response.
  if (!/payload[\s\S]{0,200}?\.status\b/.test(src) && !/serverStatus/.test(src)) {
    problems.push(
      `${MODAL}: the create response's \`status\` is never read. The 201 row carries it (RETURNING *); ` +
        `ignoring it is what allowed the toast to assert an outcome the server did not produce.`,
    );
  }

  return problems;
}

export function auditHelper(src) {
  const problems = [];

  // The helper must gate the dispatched wording on the SERVER value.
  if (!/serverStatus\s*===\s*["']dispatched["']/.test(src)) {
    problems.push(
      `${HELPER}: nothing gates the "dispatched" wording on \`serverStatus === "dispatched"\`. ` +
        `That comparison IS the fix; without it the helper can claim dispatch for any status.`,
    );
  }

  // A missing status must not fall back to claiming dispatch — silence is honest, a green lie is not.
  const missingBranch = src.match(/if\s*\(\s*!serverStatus\s*\)\s*return\s*([^;]+);/);
  if (!missingBranch) {
    problems.push(`${HELPER}: no explicit branch for a missing server status — it must not default to a dispatch claim.`);
  } else if (/and dispatched/i.test(missingBranch[1])) {
    problems.push(`${HELPER}: a missing server status still claims dispatch. It must claim nothing it cannot prove.`);
  }

  return problems;
}


/**
 * LV-STOP-ZIP-DROPPED (2026-08-08) — the same submit handler, the same honesty contract.
 *
 * This guard already asserts the handler does not tell the operator something the SERVER did not say. The
 * mirror failure is the handler silently discarding what the OPERATOR said. `stops: values.stops.map(...)` is
 * an explicit field-by-field allow-list, and `postal_code` was never added to it: the Zip Code input exists
 * and is registered, the geocode autofill writes it, the backend stop type accepts it, the INSERT lists and
 * binds it, and `mdata.load_stops.postal_code` exists on prod. PROD-MEASURED (visible 20 == n_live_tup 20, a
 * REAL zero): 0 of 20 stops have ever carried one, while city persists on 12 and address_line1 on 10.
 *
 * Postal code is the PC*MILER routing key — driver pay-per-mile, fuel/ETA and IFTA jurisdiction miles all
 * depend on it, so this is a money defect, not a cosmetic one.
 *
 * It lives HERE rather than in a second guard file because it is the same file, the same handler and the same
 * contract; a separate guard would have needed its own verify-step number and would have split one law across
 * two places.
 *
 * SCOPE, by evidence not by skip-list: a field is required on the wire only if the BACKEND can persist it.
 * `address_full` and `free_time_summary` are registered in the form but have ZERO references in
 * book-load.service.ts and no column on mdata.load_stops — UI-only scratch fields, correctly not sent.
 */
export function auditStopFieldsSent(sectionSrc, modalSrc, serviceSrc) {
  const problems = [];
  const registered = [
    ...new Set([...sectionSrc.matchAll(/stops\.\$\{index\}\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1])),
  ].sort();
  if (registered.length === 0) {
    return [`${STOPS_SECTION}: found ZERO registered stop fields — refusing to pass vacuously.`];
  }

  // RE-PIN 2026-09-06: the code evolved to use `submitStops` (a derived variable) instead of
  // `values.stops` directly, and a block body `=> {` instead of an arrow expression `=> ({`. The
  // contract is that the stops payload is a field-by-field mapping — the source variable and body
  // syntax are implementation details.
  const m = modalSrc.match(/stops:\s*(?:values\.stops|submitStops)\.map\(\(stop, index\) => \{?[\s\S]*?(?:\{([\s\S]*?)\}|return \{([\s\S]*?)\})/);
  if (!m) return [`${MODAL}: could not read the stops payload mapping — refusing to pass vacuously.`];
  const mappingBody = m[1] ?? m[2] ?? "";
  const sent = new Set([...mappingBody.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((x) => x[1]));

  for (const field of registered) {
    if (sent.has(field)) continue;
    if (!new RegExp(String.raw`\b${field}\b`).test(serviceSrc)) continue; // UI-only — correctly not sent.
    problems.push(
      `${MODAL}: the stops payload never sends "${field}", but the form registers it AND ${BOOK_SERVICE} can ` +
        `persist it. The operator fills it in, sees it on screen, and it is dropped with no error ` +
        `(LV-STOP-ZIP-DROPPED).`,
    );
  }
  return problems;
}

/**
 * DSP-F7077 — a rejected geocode lookup must not be indistinguishable from a legitimate empty result.
 * The stop address remains editable, while an explicit recoverable state retries the same exact query.
 */
export function auditGeocodeFailureRecovery(src) {
  const problems = [];
  if (!/setError\(\s*["'`]Address suggestions are unavailable\./.test(src)) {
    problems.push(`${ADDRESS_GEOCODE}: rejected geocode reads do not expose the canonical unavailable state.`);
  }
  if (!/role=["']alert["']/.test(src) || !/>\s*Retry\s*</.test(src)) {
    problems.push(`${ADDRESS_GEOCODE}: the unavailable state has no visible Retry action.`);
  }
  if (!/setRetryGeneration\(\s*\(generation\)\s*=>\s*generation\s*\+\s*1\s*\)/.test(src)) {
    problems.push(`${ADDRESS_GEOCODE}: Retry does not trigger a fresh lookup generation.`);
  }
  if (!/\[value,\s*enabled,\s*retryGeneration\]/.test(src)) {
    problems.push(`${ADDRESS_GEOCODE}: retryGeneration is not part of the lookup effect dependencies.`);
  }
  if (/catch\s*\{\s*setResults\(\[\]\);?\s*\}/.test(src)) {
    problems.push(`${ADDRESS_GEOCODE}: the shipped silent catch returned — outage still looks like zero matches.`);
  }
  return problems;
}

if (process.argv.includes("--selftest")) {
  const goodModal = `
    const serverStatus = typeof payload?.status === "string" ? String(payload.status) : null;
    pushToast(bookLoadToastMessage(saveMode, serverStatus), bookLoadToastTone(saveMode, serverStatus));
  `;
  const shippedDefect = `pushToast(saveMode === "draft" ? "Draft saved" : "Load booked and dispatched", "success");`;
  const goodAdvisory = `
    {gateBanner.type === "advisory" && pendingCloseAfterAdvisory ? (
      <Button onClick={() => { pushToast(\`\${bookLoadToastMessage("book_dispatch", advisoryServerStatus)} · maintenance advisory\`, bookLoadToastTone("book_dispatch", advisoryServerStatus)); }} />
    ) : null}
  `;
  const badAdvisory = `
    {gateBanner.type === "advisory" && pendingCloseAfterAdvisory ? (
      <Button onClick={() => { pushToast("Load booked with maintenance advisory", "success"); }} />
    ) : null}
  `;
  const stopSection = `
    <input {...register(\`stops.\${index}.city\`)} />
    <input {...register(\`stops.\${index}.postal_code\`)} />
    <input {...register(\`stops.\${index}.address_full\`)} />
  `;
  const stopsGood = `stops: values.stops.map((stop, index) => ({
          city: stop.city,
          postal_code: stop.postal_code || undefined,
        })),`;
  const stopsShipped = `stops: values.stops.map((stop, index) => ({
          city: stop.city,
        })),`;
  const stopService = `postal_code?: string; city?: string;`;
  const goodHelper = `
    if (saveMode === "draft") return "Draft saved";
    if (!serverStatus) return "Load booked — status unconfirmed";
    if (serverStatus === "dispatched") return "Load booked and dispatched";
    return \`Load booked — \${label}\`;
  `;
  const goodGeocode = `
    catch { setResults([]); setOpen(false); setError("Address suggestions are unavailable. You can keep typing the address or retry."); }
    useEffect(run, [value, enabled, retryGeneration]);
    <div role="alert"><button onClick={() => setRetryGeneration((generation) => generation + 1)}>Retry</button></div>
  `;

  const cases = [
    ["fixed modal", () => auditModal(goodModal), 0],
    ["THE SHIPPED DEFECT — saveMode picks the dispatched wording", () => auditModal(shippedDefect), 3],
    ["modal no longer uses the helper", () => auditModal(goodModal.replace("bookLoadToastMessage", "somethingElse")), 1],
    ["advisory branch reports the server status", () => auditModal(goodModal + goodAdvisory), 0],
    ["CLASS BAR — advisory branch back to a hardcoded green toast", () => auditModal(goodModal + badAdvisory), 1],
    ["fixed helper", () => auditHelper(goodHelper), 0],
    ["helper stops gating on the server status", () => auditHelper(goodHelper.replace('serverStatus === "dispatched"', "true")), 1],
    ["helper claims dispatch when status is missing", () => auditHelper(goodHelper.replace('"Load booked — status unconfirmed"', '"Load booked and dispatched"')), 1],
    ["helper drops the missing-status branch entirely", () => auditHelper(goodHelper.replace(/if \(!serverStatus\) return [^;]+;/, "")), 1],
    ["stops: every storable registered field is sent", () => auditStopFieldsSent(stopSection, stopsGood, stopService), 0],
    ["ZIP BAR — postal_code registered + storable but not sent (the shipped defect)", () => auditStopFieldsSent(stopSection, stopsShipped, stopService), 1],
    ["stops: UI-only field with no backend column is NOT demanded", () => auditStopFieldsSent(stopSection, stopsGood, "postal_code?: string;"), 0],
    ["stops: payload mapping unreadable — must not pass vacuously", () => auditStopFieldsSent(stopSection, "nothing", stopService), 1],
    ["stops: no registered fields — must not pass vacuously", () => auditStopFieldsSent("", stopsGood, stopService), 1],
    ["geocode outage is visible and retryable", () => auditGeocodeFailureRecovery(goodGeocode), 0],
    ["GEOCODE BAR — shipped silent catch", () => auditGeocodeFailureRecovery(goodGeocode.replace(/catch \{[^}]+\}/, "catch { setResults([]); }")), 2],
    ["geocode retry action removed", () => auditGeocodeFailureRecovery(goodGeocode.replace(">Retry<", ">Wait<")), 1],
    ["geocode retry does not refetch", () => auditGeocodeFailureRecovery(goodGeocode.replace("generation + 1", "generation")), 1],
    ["geocode retry omitted from dependencies", () => auditGeocodeFailureRecovery(goodGeocode.replace(", retryGeneration]", "]")), 1],
  ];

  let bad = 0;
  for (const [name, run, want] of cases) {
    const got = run().length;
    if (got !== want) {
      console.error(`SELFTEST FAIL: ${name} — expected ${want}, got ${got}`);
      bad++;
    }
  }
  if (bad) process.exit(1);
  console.log(`${LABEL} SELFTEST PASS — ${cases.length} mutations detected correctly`);
  process.exit(0);
}

for (const rel of [MODAL, HELPER, STOPS_SECTION, BOOK_SERVICE, ADDRESS_GEOCODE]) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    console.error(`${LABEL} FAIL — missing ${rel}; scope is wrong, refusing to pass vacuously.`);
    process.exit(1);
  }
}

const problems = [
  ...auditModal(fs.readFileSync(path.join(ROOT, MODAL), "utf8")),
  ...auditHelper(fs.readFileSync(path.join(ROOT, HELPER), "utf8")),
  ...auditStopFieldsSent(
    fs.readFileSync(path.join(ROOT, STOPS_SECTION), "utf8"),
    fs.readFileSync(path.join(ROOT, MODAL), "utf8"),
    fs.readFileSync(path.join(ROOT, BOOK_SERVICE), "utf8"),
  ),
  ...auditGeocodeFailureRecovery(fs.readFileSync(path.join(ROOT, ADDRESS_GEOCODE), "utf8")),
];

if (problems.length) {
  console.error(`${LABEL} FAIL — the book-load toast can claim an outcome the server did not produce:\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`\nFix: build the toast from the 201 response's \`status\` via bookLoadToastMessage(), never from saveMode.\n`);
  process.exit(1);
}

console.log(`${LABEL} OK — the book-load toast reports the status the server returned.`);
process.exit(0);
