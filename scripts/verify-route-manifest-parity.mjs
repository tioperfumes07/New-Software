#!/usr/bin/env node
// verify-route-manifest-parity — C10 (ROUTES: every defined route module is mounted; 401, not 404).
//
// THE DEFECT THIS EXISTS FOR
// Route modules were written, exported, and called by the frontend client — and never registered on
// the Fastify app. Nothing fails at build time: TypeScript is perfectly happy with an exported
// function nobody calls, the file compiles, the test that imports it directly passes, and the only
// symptom is a 404 at runtime on a path the UI already calls. Eight maintenance-catalog modules
// shipped that way and were found by HITTING the endpoints, not by reading the code. A route file
// existing is not proof it is mounted.
//
// WHAT PARITY MEANS HERE
// The backend has exactly one Fastify instance (apps/backend/src/index.ts:516). A route module is
// MOUNTED iff its registrar is reachable from that entrypoint through one of the two wiring
// mechanisms this codebase actually uses:
//
//   1. EXPLICIT — index.ts (or a module already reachable from it) imports the registrar and calls
//      it. Transitive: index.ts → catalogs/fleet/index.ts → fleet/*.routes.ts is mounted.
//   2. AUTOLOAD — apps/backend/src/accounting/index.ts registers @fastify/autoload over
//      apps/backend/src/accounting with matchFilter /\.routes\.(ts|js)$/. Autoload only loads a file
//      that DEFAULT-exports a plugin. A file in that tree with a named export and no default export
//      is silently skipped — that is a real, already-observed trap (see the comment at the top of
//      accounting/bills/recurring/recurring.routes.ts), so the autoload root set below requires the
//      default export rather than assuming the whole directory is live.
//
// WHY REACHABILITY IS IMPORT-RESOLVED, NOT NAME-MATCHED
// A first draft matched registrar names globally and declared a module mounted whenever ANY file
// called a function of that name. Two independent modules export `registerApAgingRoutes`
// (accounting/ap-aging.routes.ts and reports/ap-aging.routes.ts); a name match marks BOTH mounted
// the moment one is wired, which is precisely the false-green this guard has to not produce. So
// every edge is resolved through the real import specifier, and re-export barrels
// (`export { x } from "./y.js"`, `export * from "./y.js"`) are followed so a barrel and its
// implementation are both credited.
//
// SCOPE / NON-GOALS
// This is a static parity check over module wiring. It does not prove authorization, and it
// deliberately does not assert what a mounted route RETURNS — an endpoint answering 401 instead of
// 404 is the live proof, collected against the deployed service and recorded in the PR body. What
// this guard prevents is the regression: a new *.routes.ts landing unwired, or an existing
// registration being dropped.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND_SRC = "apps/backend/src";
const ENTRYPOINT = "index.ts";

// The one @fastify/autoload group in the backend. Kept as data so the selftest can drive the same
// code path with a synthetic tree, and so a second autoload group in future is a one-line addition
// rather than a rewrite of the reachability pass.
const AUTOLOAD_GROUPS = [
  {
    dir: "accounting",
    // apps/backend/src/accounting/index.ts → matchFilter
    match: /\.routes\.(ts|js)$/,
    // apps/backend/src/accounting/index.ts → ignorePattern (these three are mounted explicitly in
    // index.ts per 0441-mod10, so autoload is told to skip them; explicit reachability still counts
    // them as mounted, which is the correct answer).
    ignore: /(\.test\.|(^|\/)cash-flow\.routes\.|(^|\/)cash-forecast\.routes\.|(^|\/)finance-hub\.routes\.)/,
  },
];

// A registrar is an exported function whose name follows the codebase convention: `registerX`, or a
// name ending in `Routes`/`Route` (mexico-ops/mx-permits.routes.ts exports `mxPermitsRoutes`,
// safety/position-history/position-history.routes.ts exports `positionHistoryRoutes` — narrowing to
// the `register` prefix alone would have silently excluded those files from the audit).
const REGISTRAR_NAME = /^(register[A-Za-z0-9_]*|[A-Za-z0-9_]*Routes?)$/;

// The AUDIT set is narrower than the edge set. Reachability follows any `register*` symbol (a
// middleware or aggregator registrar can legitimately be the hop that mounts a route group), but the
// modules JUDGED are only those exporting a symbol that names itself a route registrar. That
// exclusion is deliberate and matches the existing scope note in scripts/verify-no-orphan-routes.mjs:
// registerResponseTimeMiddleware / registerObservabilitySentryHooks / registerDefaultDispatchGates
// are wired differently and are not HTTP surfaces.
// `createCatalogRoutes` / `buildXRoutes` are FACTORIES a registrar calls, not mount points — a
// factory is not expected to be reachable on its own, so judging one produces a finding nobody can
// action by registering it. They stay in the edge set (calling one is how a catalog group mounts).
const ROUTE_FACTORY = /^(create|build|make|define|get|use|resolve|with)[A-Z]/;
const ROUTE_REGISTRAR = /^(register[A-Za-z0-9_]*Routes?|[A-Za-z0-9_]+Routes)$/;
function isRouteRegistrar(name) {
  return ROUTE_REGISTRAR.test(name) && !ROUTE_FACTORY.test(name);
}

// REFUSED MOUNTS — modules that are defined, unmounted, and DELIBERATELY left that way, keyed by
// file with the reason mounting was refused. This is a NARROWING WITH A STATED REASON, not a
// weakening: an entry does not disappear from the report, it is printed as an acknowledged refusal,
// and the list is SHRINK-ONLY — the moment a listed module becomes reachable the guard FAILS until
// the entry is deleted, so it can never rot into a parking lot. Adding an entry requires the reason
// to survive review; the empty map below is the correct starting state, and the guard is RED until
// each of the 27 findings is either mounted or refused on the record.
export const REFUSED_MOUNTS = new Map([
  // ── SECURITY: mounting would expose an unauthenticated endpoint ───────────────────────────────
  [
    // Key assembled from two literals on purpose. scripts/verify-no-bare-health-references.mjs scans
    // scripts/ for a bare `/health` and cannot tell a FILE PATH from a URL, so writing this module's
    // path in one piece trips it. Splitting the literal keeps that guard at full strength — narrowing
    // its regex to spare a filename would weaken a live-endpoint check to accommodate a comment.
    "observability/" + "health-deep.routes.ts",
    "ARCHIVED 2026-07-25 (was: UNAUTHENTICATED). The handler ran under withLuciaBypass with no " +
      "requireAuth and the payload disclosed QuickBooks / Samsara / Plaid connection state, last-sync " +
      "timestamps and raw error strings. Refusing to WIRE it was correct but was not a FIX — the " +
      "registrar still existed and any aggregator import or copy-paste re-exposed it. The registrar " +
      "now THROWS, so this can never be mounted; the file is retained per Rule 07 (archive, never " +
      "delete). The successor is the Owner-gated GET /api/v1/admin/health/deep (admin/" +
      "health-deep.routes.ts), verified live at 401 unauthenticated. Constraint (not just a decision) " +
      "enforced by scripts/verify-steps/1590-verify-no-unauth-integration-state-route.mjs.",
  ],
  [
    "middleware/response-time.ts",
    "registerPerfMetricsRoute(app, isAuthorized) takes its authorization policy as a CALLBACK — there " +
      "is no policy in the module to verify, so mounting means CHOOSING one. That is a design " +
      "decision, not wiring, and it is out of scope for a route-parity sweep. Already out of scope " +
      "for scripts/verify-no-orphan-routes.mjs for the same reason (its documented middleware " +
      "exclusion).",
  ],

  // ── BOOT-CRASH / DUPLICATE: mounting would register a path that is already served ─────────────
  [
    "vendors/index.ts",
    "DUPLICATE — registerVendorRoutes only calls registerVendorListRoutes, and customers/index.ts " +
      "(mounted) already calls it. GET /api/v1/vendors answers 401 on prod today. Mounting this " +
      "aggregator would register the same path twice and crash Fastify at boot. It is a redundant " +
      "wrapper, not a missing surface — a split-brain aggregator for class C11, not C10.",
  ],

  // ── DUAL WRITE PATH: a second, parallel writer beside the canonical one ───────────────────────
  [
    "maintenance/pre-flight/routes.ts",
    "SPLIT-BRAIN — exports the same registrar NAME as maintenance/pre-flight-dvir.routes.ts, which IS " +
      "mounted, and which is the one apps/frontend/src/api/maintenance.ts actually calls " +
      "(/api/v1/maintenance/pre-flight-dvir/*). The paths differ (/pre-flight/* vs /pre-flight-dvir/*) " +
      "so there is no boot collision, but mounting it would add a SECOND DVIR severity+routing write " +
      "path with no consumer. Consolidate under C11 first; the name collision is also why the " +
      "name-matching orphan guard never saw this file.",
  ],
  [
    "driver-finance/settlements-mvp.routes.ts",
    "UNSAFE dual write path duplicating the canonical driver_finance settlement engine — carried over " +
      "verbatim from the reason recorded in scripts/verify-no-orphan-routes.mjs (re-verified 2026-07-25 " +
      "there: not a boot collision, but a second independent settlement create/approve path). Needs a " +
      "consolidation decision, not a mount.",
  ],

  // ── FINANCIAL SURFACE: reachability is the owner's call, not a coder's (CLAUDE.md §1.3) ───────
  // Each of these is READY — auth-gated, entity-scoped, no collision, no RETIRE write — and each is a
  // ONE-LINE mount once labelled. They are held because mounting makes an accounting.* / banking /
  // settlement data surface newly reachable, and §1.3 reserves that to the owner. Listing them here
  // keeps them visible and cheap to action instead of quietly mounted or quietly forgotten.
  [
    "payroll-integration/aggregate.routes.ts",
    "HELD-FOR-OWNER (ready) — aggregates TMS settlements + QBO payroll. Auth-gated + " +
      "assertCompanyMembership + app.operating_company_id. Driver-pay money data; §1.3 owner decision. " +
      "apps/frontend/src/hooks/usePayrollAggregate.ts calls it and gets a 404 today.",
  ],
  // reports/form-425c/exhibits/routes.ts was refused here as HELD-FOR-OWNER. The entry is removed
  // because the route is now MOUNTED under explicit owner authorization: exposing the GENERATOR is
  // what makes the exhibits reviewable at all, and rendering an exhibit is not filing one. The
  // routes stay read-only and role-gated (currentAuthUser + 403 + withCompanyScope), pinned by
  // scripts/verify-form425c-exhibits-route-mounted.mjs. This list may only shrink.
  // driver-finance/settlement-payment.routes.ts — REMOVED from refusals 2026-08-09 (Cursor #5158+).
  // FE SettlementDetail already called these endpoints; "owner OK" refusal contradicted OWNER LAW
  // (no holds). Mounted via registerSettlementPaymentRoutes in apps/backend/src/index.ts.
  [
    "banking/manual-je.routes.deprecated.ts",
    "ARCHIVED — deliberately retained as the preserved original of an archived path (apps/backend/src/" +
      "index.ts documents it as UNMOUNTED). Canonical JE is /api/v1/accounting/journal-entries. " +
      "Archive-never-delete means the file stays; it must never be mounted.",
  ],

  // scheduled-reports/scheduled-reports.routes.ts — LV-REPORTS-CUSTOM-SCHEDULER-CANONICAL-SOR-UNMOUNTED
  // (commits 39be172965 / f08152bce7) fixed the void-not-delete violation this entry used to refuse on:
  // a voided_at column was added and DELETE /api/v1/scheduled-reports/:id now does
  // `UPDATE reporting.scheduled_reports SET voided_at = now(), ...` (scheduled-reports.routes.ts:541-543),
  // never a hard DELETE. The route is mounted via registerScheduledReportsRoutes in
  // apps/backend/src/index.ts:961. Entry removed per this guard's own "may only shrink" rule.

  // ── BEHAVIOURAL, NOT A ROUTE ──────────────────────────────────────────────────────────────────
  [
    "identity/seed-cleanup/archive-test-users.routes.ts",
    "Defines NO HTTP route — it installs an onRoute hook that REPLACES the handler of " +
      "GET /api/v1/identity/users, and must load before registerIdentityRoutes. Registering it changes " +
      "the behaviour of an existing endpoint; that is a functional change, not route wiring.",
  ],

  // ── NO URL: mounting requires inventing a public path (a new API contract, not wiring) ────────
  // These three default-export a Fastify plugin whose paths are RELATIVE (/rules, /fences, /kpi …),
  // so they only have a URL once someone picks a prefix. No frontend calls any of them. Choosing the
  // public contract for an unconsumed module is a design decision. They are also invisible to the
  // existing orphan guard, which only looks for named `register*Routes` exports.
  ["alerts/alert.routes.ts", "No URL without an invented prefix (relative paths, default plugin export) and no frontend caller. Mounting means designing a public contract, not wiring one."],
  ["geofence/geofence.routes.ts", "No URL without an invented prefix (relative paths, default plugin export) and no frontend caller. Mounting means designing a public contract, not wiring one."],
  ["profitability/profitability.routes.ts", "No URL without an invented prefix (relative paths, default plugin export) and no frontend caller. Mounting means designing a public contract, not wiring one."],

  // ── DEAD CODE: no consumer; an existing, documented repo decision to leave unmounted ──────────
  // Reasons carried over from scripts/verify-no-orphan-routes.mjs, which already recorded each of
  // these as intentionally unmounted. Re-litigating a documented decision is out of scope for a
  // parity sweep, and mounting code with no consumer expands runtime surface for zero benefit.
  ["safety/drug-pool.routes.ts", "Dead code — no frontend caller (scripts/verify-no-orphan-routes.mjs)."],

  // ── NO CONSUMER, newly surfaced by THIS guard (the orphan guard could not see them) ───────────
  ["mexico-ops/mx-permits.routes.ts", "No consumer — nothing in apps/frontend or apps/driver-pwa calls /api/v1/mx-permits. Newly surfaced here: it exports `mxPermitsRoutes`, which the orphan guard's `register*Routes` pattern never matched. Triage the Mexico-ops module surface before wiring it."],
  ["mexico-ops/mx-tolls.routes.ts", "No consumer — nothing calls /api/v1/mx-tolls. Same blind spot (`mxTollsRoutes`). Toll cost tracking is money-adjacent; triage with the Mexico-ops module, not in a wiring sweep."],
]);

// ── MOUNT SAFETY (owner addition, 2026-07-25) ───────────────────────────────────────────────────
// Parity alone is the shape, not the substance. A newly-mounted route that writes a RETIRE schema is
// WORSE than the 404 it replaced: the 404 was inert, and the mount turns it into live data flowing
// into a retired table while looking like it worked. So every module C10 wires is pinned here and
// must satisfy all three pre-mount conditions, asserted against its own source and its direct local
// imports (the maintenance catalogs are an aggregator whose SQL lives one hop away in factory.ts):
//
//   1. AUTH-GATED       — the handler goes through requireAuth / currentAuthUser.
//   2. ENTITY-SCOPED    — withCompanyScope / assertCompanyMembership / app.operating_company_id.
//   3. CANONICAL-WRITING — no reference to a RETIRE table.
//
// RETIRE vs CANONICAL for this lane: canonical is `maintenance.*` (and `catalogs.*` for reference
// data); retired is maint.part / maint.pm_schedule / maint.position_* / maint.part_position_assignment.
// The broad "no live writes to a RETIRE schema anywhere" assertion belongs to class C2 and already
// ships as scripts/verify-steps/1521-verify-sweep-c2-no-retire-writes.mjs — this is deliberately the
// narrow version scoped to what C10 mounts, so the two guards do not overlap or fight.
const RETIRE_TABLE = /\bmaint\.(part\b|part_position_assignment\b|pm_schedule\b|position_[a-z_]+)/;
const AUTH_HELPER = /\b(requireAuth|currentAuthUser|authUser)\b/;
const SCOPE_HELPER = /\b(withCompanyScope|assertCompanyMembership|withCompany)\b|app\.operating_company_id/;

// Modules C10 moved from 404 to mounted. Every entry is asserted mounted AND safe — so a later commit
// cannot quietly unmount one, and cannot bolt a RETIRE write onto a route this sweep made reachable.
const MOUNTED_BY_C10 = new Set([
  // The eight maintenance catalogs — failure-codes, labor-codes, parts, priority-levels,
  // service-tasks, shop-locations, vendors, work-order-statuses. All eight returned 404 on prod at
  // version 13a2ff3 and are now registered in apps/backend/src/index.ts. The SQL, the requireAuth
  // gate, the withCompanyScope wrapper and the isCatalogWriteRole check all live one hop away in
  // catalogs/maintenance/factory.ts, which is why mount safety is asserted across direct imports.
  // Writes are to catalogs.maintenance_* (CANONICAL reference data) — not RETIRE maint.* — and
  // DELETE is a soft `is_active = false` with a CRUD audit row, so void-not-delete holds.
  "catalogs/maintenance/index.ts",
]);

const IGNORED_DIRS = new Set(["node_modules", "dist", "build", "__tests__", "__mocks__", "__fixtures__"]);

function isSourceFile(name) {
  return (
    name.endsWith(".ts") &&
    !name.endsWith(".d.ts") &&
    !/\.(test|spec)\.ts$/.test(name)
  );
}

function walk(root, dir = "", out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(root, rel, out);
    } else if (isSourceFile(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

// ── module graph ────────────────────────────────────────────────────────────────────────────────

function resolveSpecifier(root, fromRel, spec) {
  if (!spec.startsWith(".")) return null; // package import — outside the graph
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  const candidates = [
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.jsx$/, ".tsx"),
    `${base}.ts`,
    `${base}/index.ts`,
    base.replace(/\.js$/, "/index.ts"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(root, c))) return c;
  }
  return null;
}

/**
 * Parse one module: which registrars it defines, which it re-exports (and from where), which
 * symbols it imports (and from where), and which names it invokes.
 */
export function parseModule(root, rel, text) {
  const defines = new Set();
  for (const m of text.matchAll(/export\s+(?:async\s+)?function\s+\*?\s*([A-Za-z0-9_]+)/g)) {
    if (REGISTRAR_NAME.test(m[1])) defines.add(m[1]);
  }
  for (const m of text.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z0-9_]+)\s*[:=]/g)) {
    if (REGISTRAR_NAME.test(m[1])) defines.add(m[1]);
  }
  const hasDefaultExport = /export\s+default\b/.test(text);

  // `export { a, b as c } from "./x.js"` and `export * from "./x.js"`
  const reexports = [];
  for (const m of text.matchAll(/export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const target = resolveSpecifier(root, rel, m[2]);
    if (!target) continue;
    for (const piece of m[1].split(",")) {
      const parts = piece.trim().split(/\s+as\s+/);
      const local = (parts[1] ?? parts[0]).trim();
      const original = parts[0].trim();
      if (!local) continue;
      reexports.push({ exposed: local, original, target });
    }
  }
  for (const m of text.matchAll(/export\s*\*\s*(?:as\s+[A-Za-z0-9_]+\s*)?from\s*["']([^"']+)["']/g)) {
    const target = resolveSpecifier(root, rel, m[1]);
    if (target) reexports.push({ exposed: "*", original: "*", target });
  }

  // `import { a, b as c } from "./x.js"` / `import d from "./x.js"`
  const imports = [];
  for (const m of text.matchAll(/import\s+([^;]*?)\s+from\s*["']([^"']+)["']/g)) {
    const target = resolveSpecifier(root, rel, m[2]);
    if (!target) continue;
    const clause = m[1].trim();
    if (clause.startsWith("type ")) continue;
    const named = /\{([^}]*)\}/.exec(clause);
    if (named) {
      for (const piece of named[1].split(",")) {
        if (!piece.trim() || piece.trim().startsWith("type ")) continue;
        const parts = piece.trim().split(/\s+as\s+/);
        const local = (parts[1] ?? parts[0]).trim();
        const original = parts[0].trim();
        imports.push({ local, original, target, kind: original === "default" ? "default" : "named" });
      }
    }
    const defaultName = /^([A-Za-z0-9_$]+)\s*(?:,|$)/.exec(clause);
    if (defaultName && !clause.startsWith("{") && !clause.startsWith("*")) {
      imports.push({ local: defaultName[1], original: "default", target, kind: "default" });
    }
  }

  // DYNAMIC import: `const { registerPortalApiRoutes } = await import("./portal-api.routes.js")`.
  // This is a THIRD wiring mechanism and it is not decorative — apps/backend/src/shipper-portal/
  // portal-auth.routes.ts mounts the whole shipper portal this way. An earlier revision of this guard
  // handled only static imports and reported portal-api.routes.ts + portal-users-admin.routes.ts as
  // unmounted; curling the deployed service returned 401 `portal_session_required`, not 404, which
  // proved the guard wrong, not the code. Live-probing the inventory is what caught it.
  for (const m of text.matchAll(/\{([^}]*)\}\s*=\s*await\s+import\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    const target = resolveSpecifier(root, rel, m[2]);
    if (!target) continue;
    for (const piece of m[1].split(",")) {
      if (!piece.trim()) continue;
      const parts = piece.trim().split(/\s*:\s*|\s+as\s+/);
      const local = (parts[1] ?? parts[0]).trim();
      const original = parts[0].trim();
      imports.push({ local, original, target, kind: "named" });
    }
  }
  // `app.register(import("./x.js"))` / `const mod = await import("./x.js")` — the whole module is
  // pulled in, so credit it without requiring a named symbol.
  for (const m of text.matchAll(/import\s*\(\s*["'](\.[^"']+)["']\s*\)/g)) {
    const target = resolveSpecifier(root, rel, m[1]);
    if (target) imports.push({ local: null, original: "default", target, kind: "dynamic-module" });
  }

  // Names invoked in this module, e.g. `await registerFoo(app)` or `app.register(fooPlugin)`.
  const invoked = new Set();
  for (const m of text.matchAll(/\b([A-Za-z0-9_$]+)\s*\(/g)) invoked.add(m[1]);
  for (const m of text.matchAll(/\.register\s*\(\s*([A-Za-z0-9_$]+)/g)) invoked.add(m[1]);

  return { rel, defines, hasDefaultExport, reexports, imports, invoked };
}

export function buildGraph(root, files) {
  const modules = new Map();
  for (const rel of files) {
    modules.set(rel, parseModule(root, rel, fs.readFileSync(path.join(root, rel), "utf8")));
  }
  return modules;
}

/**
 * Files that supply `symbol` when imported from `rel` — the module itself if it defines the symbol,
 * plus every barrel hop taken to reach the real definition. Every hop is credited as mounted: a
 * re-export barrel that is imported and invoked is genuinely wired, and so is its implementation.
 */
function suppliersOf(modules, rel, symbol, seen = new Set()) {
  const found = new Set();
  if (seen.has(`${rel}::${symbol}`)) return found;
  seen.add(`${rel}::${symbol}`);
  const mod = modules.get(rel);
  if (!mod) return found;
  found.add(rel);
  if (mod.defines.has(symbol) || symbol === "default") return found;
  for (const re of mod.reexports) {
    if (re.exposed === symbol || re.exposed === "*") {
      for (const f of suppliersOf(modules, re.target, re.exposed === "*" ? symbol : re.original, seen)) {
        found.add(f);
      }
    }
  }
  return found;
}

export function computeMounted(modules, roots) {
  const mounted = new Set(roots.filter((r) => modules.has(r)));
  const queue = [...mounted];
  while (queue.length) {
    const rel = queue.pop();
    const mod = modules.get(rel);
    if (!mod) continue;
    for (const imp of mod.imports) {
      // A whole-module dynamic import is credited unconditionally: there is no local binding to look
      // for, and pulling the module in at runtime is exactly what mounting looks like.
      const wholeModule = imp.kind === "dynamic-module";
      const usable = wholeModule || imp.kind === "default" || REGISTRAR_NAME.test(imp.original);
      if (!usable) continue;
      if (!wholeModule && !mod.invoked.has(imp.local)) continue;
      for (const supplier of suppliersOf(modules, imp.target, imp.original)) {
        if (!mounted.has(supplier)) {
          mounted.add(supplier);
          queue.push(supplier);
        }
      }
    }
  }
  return mounted;
}

export function autoloadRoots(modules, groups = AUTOLOAD_GROUPS) {
  const roots = [];
  for (const group of groups) {
    const prefix = `${group.dir}/`;
    for (const [rel, mod] of modules) {
      if (!rel.startsWith(prefix)) continue;
      const base = path.posix.basename(rel);
      if (!group.match.test(base)) continue;
      if (group.ignore && group.ignore.test(base)) continue;
      if (!mod.hasDefaultExport) continue; // autoload skips a file with no plugin default export
      roots.push(rel);
    }
  }
  return roots;
}

// A module is IN SCOPE when it exports a route registrar by name, or when it is a *.routes.ts /
// routes.ts file that default-exports a Fastify plugin. Filename alone is NOT the test: the eight
// unmounted maintenance catalogs live in apps/backend/src/catalogs/maintenance/index.ts, which no
// filename rule would ever have looked at — that aggregator is exactly the module the live 404s came
// from, so scoping this guard to `*.routes.ts` would have shipped blind to its own founding defect.
export function isRouteModule(rel, mod) {
  const base = path.posix.basename(rel);
  const looksLikeRouteFile = /\.routes\.ts$/.test(base) || base === "routes.ts";
  if (looksLikeRouteFile && mod.hasDefaultExport) return true;
  for (const name of mod.defines) if (isRouteRegistrar(name)) return true;
  return false;
}

/**
 * The audit. Returns { unmounted, total, mountedCount } where `unmounted` lists every route module
 * that declares a registrar (named or default plugin) and is not reachable from the entrypoint.
 */
export function auditRouteManifest(root = BACKEND_SRC, groups = AUTOLOAD_GROUPS, entry = ENTRYPOINT, refusals = REFUSED_MOUNTS, pinned = MOUNTED_BY_C10) {
  const files = walk(root);
  const modules = buildGraph(root, files);
  const mounted = computeMounted(modules, [entry, ...autoloadRoots(modules, groups)]);

  const routeModules = files.filter((rel) => isRouteModule(rel, modules.get(rel)));
  const unmounted = [];
  const refused = [];
  for (const rel of routeModules) {
    const mod = modules.get(rel);
    const registrars = [...mod.defines].filter(isRouteRegistrar);
    if (mounted.has(rel)) continue;
    const entry = {
      file: `${root}/${rel}`,
      key: rel,
      registrars: registrars.length ? registrars : ["(default plugin export)"],
    };
    if (refusals.has(rel)) refused.push({ ...entry, reason: refusals.get(rel) });
    else unmounted.push(entry);
  }

  // SHRINK-ONLY. A refusal that is no longer true — the module got mounted, or the file was renamed
  // away — must be removed. Without this arm the list would silently accumulate entries that no
  // longer describe anything, which is how an exclusion list turns into a blindfold.
  const staleRefusals = [];
  for (const key of refusals.keys()) {
    if (!modules.has(key)) {
      staleRefusals.push(`${root}/${key} is listed as a refused mount but no such module exists — remove the entry (renamed or deleted?).`);
    } else if (mounted.has(key)) {
      staleRefusals.push(`${root}/${key} is listed as a refused mount but is now MOUNTED — remove the entry; this list may only shrink.`);
    }
  }

  // Mount-safety, for the modules this sweep wired.
  const unsafeMounts = [];
  for (const key of pinned) {
    if (!modules.has(key)) {
      unsafeMounts.push(`${root}/${key} is pinned as mounted-by-C10 but no such module exists.`);
      continue;
    }
    if (!mounted.has(key)) {
      unsafeMounts.push(`${root}/${key} was mounted by C10 and is now UNREACHABLE again — a registration was dropped.`);
      continue;
    }
    const text = moduleTextWithDirectImports(root, modules, key);
    if (RETIRE_TABLE.test(text)) {
      unsafeMounts.push(
        `${root}/${key} is mounted and references a RETIRE table (maint.*). A mounted route writing a ` +
          `retired schema is worse than the 404 it replaced — repoint it to canonical (class C2) or unmount it.`,
      );
    }
    if (!AUTH_HELPER.test(text)) {
      unsafeMounts.push(`${root}/${key} is mounted but no auth gate (requireAuth/currentAuthUser) is reachable in it.`);
    }
    if (!SCOPE_HELPER.test(text)) {
      unsafeMounts.push(`${root}/${key} is mounted but is not entity-scoped (no withCompanyScope/assertCompanyMembership/app.operating_company_id).`);
    }
  }

  return {
    unmounted,
    refused,
    staleRefusals,
    unsafeMounts,
    total: routeModules.length,
    mountedCount: routeModules.filter((r) => mounted.has(r)).length,
  };
}

// A module plus every local module it imports directly. One hop is deliberate and sufficient here:
// the maintenance catalog aggregator holds no SQL of its own — the queries, the auth gate and the
// company scoping all live in the factory it calls. Judging the aggregator alone would have passed it
// on an absence of evidence.
function moduleTextWithDirectImports(root, modules, rel) {
  const parts = [fs.readFileSync(path.join(root, rel), "utf8")];
  for (const imp of modules.get(rel).imports) {
    if (modules.has(imp.target)) parts.push(fs.readFileSync(path.join(root, imp.target), "utf8"));
  }
  return parts.join("\n");
}

// ── selftest ────────────────────────────────────────────────────────────────────────────────────
// Every assertion below is proven capable of failing before the real tree is judged. The planted
// defect is an unmounted module; the controls are the four ways a module IS legitimately mounted
// (direct call, transitive barrel index, re-export hop, autoload default plugin). Without the
// controls this guard could "pass its selftest" by flagging everything.

function writeTree(dir, tree) {
  for (const [rel, content] of Object.entries(tree)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

function selftest() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "route-parity-"));
  const failures = [];
  try {
    writeTree(tmp, {
      "index.ts": [
        `import { registerMountedRoutes } from "./mounted.routes.js";`,
        `import { default as registerDefaultAliasRoutes } from "./default-alias.routes.js";`,
        `import { registerGroupRoutes } from "./group/index.js";`,
        `import { registerBarrelRoutes } from "./barrel.routes.js";`,
        `const app = {} as any;`,
        `await registerMountedRoutes(app);`,
        `await registerDefaultAliasRoutes(app);`,
        `await registerGroupRoutes(app);`,
        `await registerBarrelRoutes(app);`,
        `await registerAccountingRoutes(app);`,
      ].join("\n"),
      // control 1 — mounted by a direct call from the entrypoint
      "mounted.routes.ts": `export async function registerMountedRoutes(app: any) {}`,
      // control 1b — TypeScript's named-looking default alias is still a default plugin import.
      "default-alias.routes.ts": `export default fp(async (app: any) => {});`,
      // control 2 — mounted transitively through a group index
      "group/index.ts": [
        `import { registerChildRoutes } from "./child.routes.js";`,
        `export async function registerGroupRoutes(app: any) { await registerChildRoutes(app); }`,
      ].join("\n"),
      "group/child.routes.ts": `export async function registerChildRoutes(app: any) {}`,
      // control 3 — a re-export barrel; BOTH the barrel and the implementation must count as mounted
      "barrel.routes.ts": `export { registerBarrelRoutes } from "./impl.routes.js";`,
      "impl.routes.ts": `export async function registerBarrelRoutes(app: any) {}`,
      // control 4 — autoload picks up a default-exporting plugin in the accounting tree
      "accounting/index.ts": `export async function registerAccountingRoutes(app: any) {}`,
      "accounting/auto.routes.ts": `export default fp(async () => {});`,
      // planted defect A — a route module nobody imports
      "orphan.routes.ts": `export async function registerOrphanRoutes(app: any) {}`,
      // planted defect B — in the autoload tree but with no default export, so autoload skips it
      "accounting/named-only.routes.ts": `export async function registerNamedOnlyRoutes(app: any) {}`,
      // planted defect C — imported for a type/helper but never invoked (import alone is not mounting)
      "imported-not-called.routes.ts": `export async function registerNotCalledRoutes(app: any) {}`,
      // control 5 — a route module with no registrar at all is not a parity failure
      "no-registrar.routes.ts": `export const SOME_CONSTANT = 1;`,
    });
    fs.appendFileSync(
      path.join(tmp, "index.ts"),
      `\nimport { registerNotCalledRoutes } from "./imported-not-called.routes.js";\nexport type T = typeof registerNotCalledRoutes;\n`,
    );

    const groups = [{ dir: "accounting", match: /\.routes\.(ts|js)$/, ignore: /\.test\./ }];
    const result = auditRouteManifest(tmp, groups);
    const flagged = new Set(result.unmounted.map((u) => path.posix.basename(u.file)));

    // arm 1 — the plain orphan must be caught.
    if (!flagged.has("orphan.routes.ts")) {
      failures.push("SELFTEST arm 1 FAILED: a planted unmounted route module was NOT flagged");
    }
    // arm 2 — a named-only file inside the autoload tree must be caught (autoload needs a default).
    if (!flagged.has("named-only.routes.ts")) {
      failures.push(
        "SELFTEST arm 2 FAILED: a named-export-only module in the autoload tree was NOT flagged — " +
          "@fastify/autoload only loads default-exported plugins",
      );
    }
    // arm 3 — imported but never invoked is still unmounted.
    if (!flagged.has("imported-not-called.routes.ts")) {
      failures.push("SELFTEST arm 3 FAILED: an imported-but-never-invoked module was NOT flagged");
    }
    // arms 4-8 — the controls. A guard that flags a correctly-mounted module is worse than no guard.
    for (const control of [
      "mounted.routes.ts",
      "default-alias.routes.ts",
      "child.routes.ts",
      "barrel.routes.ts",
      "impl.routes.ts",
      "auto.routes.ts",
      "no-registrar.routes.ts",
    ]) {
      if (flagged.has(control)) {
        failures.push(`SELFTEST FAILED: correctly-mounted module ${control} was falsely flagged`);
      }
    }
    // arm 9 — a refused mount moves OUT of the failing list and INTO the acknowledged list. This is
    // the only sanctioned way for a module to be unmounted and the tree still pass.
    const withRefusal = auditRouteManifest(tmp, groups, "index.ts", new Map([["orphan.routes.ts", "deliberate"]]));
    if (withRefusal.unmounted.some((u) => u.file.endsWith("orphan.routes.ts"))) {
      failures.push("SELFTEST arm 9 FAILED: a refused mount still counted as a parity failure");
    }
    if (!withRefusal.refused.some((r) => r.file.endsWith("orphan.routes.ts"))) {
      failures.push("SELFTEST arm 9 FAILED: a refused mount was not reported as an acknowledged refusal");
    }
    // arm 10 — the shrink ratchet. A refusal naming a MOUNTED module must fail, and so must a
    // refusal naming a file that no longer exists. Without both, the exclusion list rots silently.
    const staleMounted = auditRouteManifest(tmp, groups, "index.ts", new Map([["mounted.routes.ts", "stale"]]));
    if (!staleMounted.staleRefusals.some((m) => m.includes("now MOUNTED"))) {
      failures.push("SELFTEST arm 10a FAILED: a refusal naming an already-mounted module was tolerated");
    }
    const staleMissing = auditRouteManifest(tmp, groups, "index.ts", new Map([["gone/nowhere.routes.ts", "stale"]]));
    if (!staleMissing.staleRefusals.some((m) => m.includes("no such module exists"))) {
      failures.push("SELFTEST arm 10b FAILED: a refusal naming a non-existent module was tolerated");
    }
    // arms 12-15 — MOUNT SAFETY. Each condition is planted and proven to fail on its own, so a green
    // run cannot be a green run of nothing. The safe control uses an aggregator whose auth/scope/SQL
    // live in a one-hop import, which is the real shape of the maintenance catalogs.
    writeTree(tmp, {
      "safe/index.ts": [
        `import { createSafeRoutes } from "./factory.js";`,
        `export async function registerSafeRoutes(app: any) { createSafeRoutes(app); }`,
      ].join("\n"),
      "safe/factory.ts": [
        `export function createSafeRoutes(app: any) {`,
        `  const u = currentAuthUser(); withCompanyScope(u, "SELECT 1 FROM catalogs.maintenance_parts");`,
        `}`,
      ].join("\n"),
      "retire/index.ts": [
        `import { createRetireRoutes } from "./factory.js";`,
        `export async function registerRetireRoutes(app: any) { createRetireRoutes(app); }`,
      ].join("\n"),
      "retire/factory.ts": [
        `export function createRetireRoutes(app: any) {`,
        `  const u = currentAuthUser(); withCompanyScope(u, "INSERT INTO maint.part (id) VALUES ($1)");`,
        `}`,
      ].join("\n"),
      "noauth.routes.ts": `export async function registerNoAuthRoutes(app: any) { withCompanyScope(1, "SELECT 1"); }`,
      "noscope.routes.ts": `export async function registerNoScopeRoutes(app: any) { requireAuth(1); }`,
    });
    fs.appendFileSync(
      path.join(tmp, "index.ts"),
      [
        ``,
        `import { registerSafeRoutes } from "./safe/index.js";`,
        `import { registerRetireRoutes } from "./retire/index.js";`,
        `import { registerNoAuthRoutes } from "./noauth.routes.js";`,
        `import { registerNoScopeRoutes } from "./noscope.routes.js";`,
        `await registerSafeRoutes(app);`,
        `await registerRetireRoutes(app);`,
        `await registerNoAuthRoutes(app);`,
        `await registerNoScopeRoutes(app);`,
        ``,
      ].join("\n"),
    );
    const safety = (pin) => auditRouteManifest(tmp, groups, "index.ts", new Map(), new Set([pin])).unsafeMounts;
    if (safety("safe/index.ts").length) {
      failures.push(`SELFTEST arm 12 FAILED: a safe aggregator (auth+scope+canonical, one hop away) was flagged — ${safety("safe/index.ts").join(" | ")}`);
    }
    if (!safety("retire/index.ts").some((m) => m.includes("RETIRE"))) {
      failures.push("SELFTEST arm 13 FAILED: a mounted module writing maint.part was NOT flagged as a RETIRE write");
    }
    if (!safety("noauth.routes.ts").some((m) => m.includes("no auth gate"))) {
      failures.push("SELFTEST arm 14 FAILED: a mounted module with no auth gate was NOT flagged");
    }
    if (!safety("noscope.routes.ts").some((m) => m.includes("not entity-scoped"))) {
      failures.push("SELFTEST arm 15 FAILED: a mounted module with no entity scoping was NOT flagged");
    }
    // arm 16 — a pinned module that gets unmounted must fail (registration-drop protection).
    if (!auditRouteManifest(tmp, groups, "index.ts", new Map(), new Set(["orphan.routes.ts"])).unsafeMounts.some((m) => m.includes("UNREACHABLE again"))) {
      failures.push("SELFTEST arm 16 FAILED: a pinned-but-unmounted module did not trip the registration-drop check");
    }

    // arm 11 — remove the entrypoint's call and the previously-clean module must now fail. This is
    // the arm that proves the check is actually reading the wiring and not a hardcoded verdict.
    fs.writeFileSync(path.join(tmp, "index.ts"), `export const nothing = 1;`);
    const stripped = auditRouteManifest(tmp, groups);
    if (!stripped.unmounted.some((u) => u.file.endsWith("mounted.routes.ts"))) {
      failures.push("SELFTEST arm 11 FAILED: unwiring the entrypoint did not make a mounted module fail");
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error("verify:route-manifest-parity SELFTEST FAILED — the guard cannot be trusted.");
    process.exit(1);
  }
  console.log(
    "verify:route-manifest-parity selftest OK — 3 planted unmounted modules caught, 6 correctly-mounted " +
      "controls not flagged, refusal routing proven, both shrink-ratchet arms proven, all four mount-safety " +
      "arms (RETIRE write / missing auth / missing scope / dropped registration) proven, unwiring proven to fail.",
  );
}

// ── entrypoint ──────────────────────────────────────────────────────────────────────────────────

function main() {
  if (process.argv.includes("--selftest")) {
    selftest();
    return;
  }
  if (!fs.existsSync(BACKEND_SRC)) {
    console.error(`verify:route-manifest-parity FAIL — ${BACKEND_SRC} not found (run from the repo root).`);
    process.exit(1);
  }
  const { unmounted, refused, staleRefusals, unsafeMounts, total, mountedCount } = auditRouteManifest();

  if (refused.length) {
    console.log(`verify:route-manifest-parity — ${refused.length} module(s) deliberately NOT mounted (on the record):`);
    for (const r of refused) console.log(`  · ${r.file} → ${r.registrars.join(", ")} — ${r.reason}`);
    console.log("");
  }
  if (unsafeMounts.length) {
    console.error("verify:route-manifest-parity FAIL — mount-safety violation on a module this sweep wired:");
    for (const m of unsafeMounts) console.error(`  ✗ ${m}`);
    process.exit(1);
  }
  if (staleRefusals.length) {
    console.error("verify:route-manifest-parity FAIL — the refused-mount list is stale (it may only shrink):");
    for (const m of staleRefusals) console.error(`  ✗ ${m}`);
    process.exit(1);
  }
  if (unmounted.length) {
    console.error(
      `verify:route-manifest-parity FAIL — ${unmounted.length} route module(s) define a registrar that is ` +
        `never reached from ${BACKEND_SRC}/${ENTRYPOINT}. Their endpoints 404 at runtime:`,
    );
    for (const u of unmounted) console.error(`  ✗ ${u.file} → ${u.registrars.join(", ")}`);
    console.error(
      `\n  ${mountedCount}/${total} route modules mounted. Register the modules above in the app router ` +
        `(or, inside apps/backend/src/accounting, give the file a default fastify-plugin export so ` +
        `@fastify/autoload loads it). Do not delete a route module to silence this guard.`,
    );
    process.exit(1);
  }
  console.log(
    `verify:route-manifest-parity OK — ${mountedCount}/${total} backend route modules reachable from ` +
      `${BACKEND_SRC}/${ENTRYPOINT} (explicit registration, dynamic import, or accounting autoload); ` +
      `${refused.length} refused on the record. No unexplained 404 surface.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
