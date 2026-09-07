#!/usr/bin/env node
// CUR-3 guard (inventory row 51; owner 2026-09-05 21:5xZ "our top banner size has been reduced. it
// was bigger."). Source of truth: docs/design/reference/DISPATCH-BOARD-PREVIEW-2026-09-05.pdf +
// docs/specs/GLOBAL-TYPE-SIZE-BASELINE.md (H1 22px). Spec heights the GLB sweeps regressed:
//   - top status bar (TopStatusBar.tsx [data-status-bar-desktop]) = 26px
//   - module banner H1 (PageHeader.tsx, via typography.pageHeading) = 22px type
//
// "Computed height from a component test": the rendered height is derived from the element's own
// Tailwind tokens (padding + font-size x line-height, floored by any min-h/h) — the same number the
// browser lays out — and asserted equal to spec. No hand-typed number to drift.
//
// --selftest shrinks the bar (drops min-h-[26px]) and shrinks the H1 (pageHeading -> 18) and requires
// each to FAIL; the real sources must pass.
import fs from "node:fs";

const TOPBAR = "apps/frontend/src/components/layout/TopStatusBar.tsx";
const PAGEHEADER = "apps/frontend/src/components/layout/PageHeader.tsx";
const MODULEHEADER = "apps/frontend/src/components/layout/ModuleHeader.tsx";
const TOKENS = "apps/frontend/src/design/tokens.ts";

const SPEC_TOPBAR_HEIGHT_PX = 26; // DISPATCH-BOARD-PREVIEW-2026-09-05.pdf top bar
const SPEC_MODULE_H1_PX = 22; // GLOBAL-TYPE-SIZE-BASELINE.md H1

const PY = { "py-0": 0, "py-0.5": 2, "py-1": 4, "py-1.5": 6, "py-2": 8, "py-2.5": 10, "py-3": 12 };
const LEADING = { "leading-none": 1, "leading-tight": 1.25, "leading-snug": 1.375, "leading-normal": 1.5, "leading-relaxed": 1.625 };
const TEXT = { "text-xs": 12, "text-sm": 14, "text-base": 16, "text-lg": 18 };

/** Pull the className string on the element carrying `marker` (searches back from the marker). */
function classNameFor(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const window = src.slice(Math.max(0, at - 600), at);
  const matches = [...window.matchAll(/className="([^"]*)"/g)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

/** Computed rendered height (px) from the element's Tailwind tokens — padding + line box, floored by
 * any explicit min-h-[Npx] / h-[Npx]. Mirrors the browser's box height for this simple pill. */
function computedHeight(cls) {
  const tokens = cls.split(/\s+/);
  let padY = 0;
  let font = 12; // text-xs default when unspecified
  let leading = 1.5; // browser default line-height when unspecified
  let floor = 0;
  for (const t of tokens) {
    if (t in PY) padY = PY[t];
    if (t in TEXT) font = TEXT[t];
    if (t in LEADING) leading = LEADING[t];
    const arb = t.match(/^text-\[(\d+(?:\.\d+)?)px\]$/);
    if (arb) font = parseFloat(arb[1]);
    const mh = t.match(/^(?:min-h|h)-\[(\d+(?:\.\d+)?)px\]$/);
    if (mh) floor = Math.max(floor, parseFloat(mh[1]));
  }
  const content = padY * 2 + font * leading;
  return { height: Math.max(content, floor), floor, content, font, leading, padY };
}

/** typography.pageHeading numeric value from tokens.ts. */
function pageHeadingPx(src) {
  const m = src.match(/pageHeading:\s*(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function analyze(topbar, pageHeader, moduleHeader, tokens) {
  const errors = [];

  // 1) Top status bar height == spec (computed from its own tokens).
  const barCls = classNameFor(topbar, "data-status-bar-desktop");
  if (!barCls) {
    errors.push("TopStatusBar: [data-status-bar-desktop] element / className not found");
  } else {
    const { height } = computedHeight(barCls);
    if (Math.round(height) !== SPEC_TOPBAR_HEIGHT_PX)
      errors.push(`top status bar computed height ${height}px !== spec ${SPEC_TOPBAR_HEIGHT_PX}px (PDF top bar). It was reduced by the GLB sweeps — restore it.`);
  }

  // 2) Module banner H1 type == spec, and the header actually uses the token.
  const h1 = pageHeadingPx(tokens);
  if (h1 == null) errors.push("tokens.ts: typography.pageHeading not found");
  else if (h1 !== SPEC_MODULE_H1_PX)
    errors.push(`module banner H1 type ${h1}px !== spec ${SPEC_MODULE_H1_PX}px (GLOBAL-TYPE-SIZE-BASELINE H1)`);
  if (!/fontSize:\s*typography\.pageHeading/.test(pageHeader))
    errors.push("PageHeader: the module banner H1 does not use typography.pageHeading (spec type would drift)");
  if (!/PageHeader/.test(moduleHeader))
    errors.push("ModuleHeader: does not delegate to PageHeader (module banner height would not be governed by spec)");

  return errors;
}

const topbar = fs.readFileSync(TOPBAR, "utf8");
const pageHeader = fs.readFileSync(PAGEHEADER, "utf8");
const moduleHeader = fs.readFileSync(MODULEHEADER, "utf8");
const tokens = fs.readFileSync(TOKENS, "utf8");

if (process.argv.includes("--selftest")) {
  const clean = analyze(topbar, pageHeader, moduleHeader, tokens);
  if (clean.length) {
    console.error(`SELFTEST FAIL — clean source rejected:\n- ${clean.join("\n- ")}`);
    process.exit(1);
  }

  const mutations = [
    ["shrink the bar (drop min-h-[26px])", [topbar.replace(/\bmin-h-\[26px\]\s*/, ""), pageHeader, moduleHeader, tokens]],
    ["shrink the bar padding (py-1 -> py-0)", [topbar.replace("min-h-[26px] ", "").replace("py-1", "py-0"), pageHeader, moduleHeader, tokens]],
    ["shrink the H1 (pageHeading 22 -> 18)", [topbar, pageHeader, moduleHeader, tokens.replace(/pageHeading:\s*22/, "pageHeading: 18")]],
    ["H1 stops using the token", [topbar, pageHeader.replace("fontSize: typography.pageHeading", "fontSize: 14"), moduleHeader, tokens]],
  ];
  let caught = 0;
  for (const [label, args] of mutations) {
    if (analyze(...args).length > 0) {
      caught += 1;
      continue;
    }
    console.error(`SELFTEST FAIL — mutation escaped: ${label}`);
    process.exit(1);
  }
  console.log(`PASS verify-top-banner-spec-heights --selftest ${caught}/${mutations.length}`);
  process.exit(0);
}

const failures = analyze(topbar, pageHeader, moduleHeader, tokens);
if (failures.length) {
  console.error("FAIL verify-top-banner-spec-heights");
  failures.forEach((f) => console.error(`- ${f}`));
  process.exit(1);
}
console.log("PASS verify-top-banner-spec-heights");
