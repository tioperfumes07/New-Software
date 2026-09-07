#!/usr/bin/env node
// LDT-7 guard (register docs/bus/CURSOR-LOAD-DETAIL-TABS-BUILD-2026-09-05.md § LDT-7; owner 22:55Z;
// DESIGN-CONTRACT § Audit). Owner-measured live on load 13526: the Audit tab printed machine codes
// (`dispatch.load_created`) and the block id `P6-D3` (the row's `source`). Law (00-IH35-LAW §"Plain
// English on every operator-visible surface"): no machine names, no all-capitals data on screen.
//
// Asserts, on tip source (no runtime self-certification):
//   Sentence dictionary (loadAuditSentences.ts):
//     - describeLoadAuditEvent falls back to humanizeAuditEventType (English), never the raw code;
//     - it scrubs any block-id token and re-humanizes if the text is still a bare code
//       (RAW_CODE_RE / BLOCK_ID_RE floor) — a code can never reach the screen;
//     - every row's Opens target is guaranteed (opens: { kind: "load", ... } is never null).
//   FE tab (LoadAuditTab.tsx):
//     - renders via describeLoadAuditEvent (not the raw event_class);
//     - columns When · Who · What happened · Money · Opens;
//     - filters Range (from/to) · Type · Who;
//     - CSV export KEEPS the machine codes (event_class + source), the screen does not;
//     - Opens is rendered for every row from row.opens;
//     - no hex colour literals (palette = .ldt-* tokens only).
//   Drawer (LoadDetailDrawer.tsx):
//     - the Audit tab renders LoadAuditTab and no longer renders the code-printing EntityAuditHistoryTab.
//
// --selftest injects a raw machine code into the row-text validator and requires it to FAIL, then
// plants a mutation per rule above and requires each to be caught.
import fs from "node:fs";

const SENT = "apps/frontend/src/components/dispatch/loadAuditSentences.ts";
const TAB = "apps/frontend/src/components/dispatch/LoadAuditTab.tsx";
const DRAWER = "apps/frontend/src/components/dispatch/LoadDetailDrawer.tsx";

// The two shapes a machine token can take on screen — the exact rule the register names.
const RAW_CODE_RE = /^[a-z_.]+$/;
const BLOCK_ID_RE = /[A-Z]+-\d+-/;

/** The row-text rule, self-contained so --selftest can prove a raw code is rejected. */
function validateRowText(text, hasOpens) {
  const errors = [];
  const t = String(text ?? "").trim();
  if (!t) errors.push("empty row text");
  else if (RAW_CODE_RE.test(t)) errors.push(`row text is a raw machine code: "${t}"`);
  else if (BLOCK_ID_RE.test(t)) errors.push(`row text contains a block id: "${t}"`);
  if (!hasOpens) errors.push("row has no Opens target");
  return errors;
}

function auditSentences(src) {
  const errors = [];
  if (!src.includes("humanizeAuditEventType(ev.event_class)"))
    errors.push("sentences: unknown codes are not humanized via humanizeAuditEventType — a raw code could reach the screen");
  if (!src.includes("RAW_CODE_RE") || !src.includes("BLOCK_ID_RE"))
    errors.push("sentences: the RAW_CODE_RE / BLOCK_ID_RE floor is missing — a bare code could survive as visible text");
  if (!/opens:\s*\{\s*kind:\s*"load"/.test(src))
    errors.push("sentences: describeLoadAuditEvent does not guarantee an Opens target (opens must default to the load, never null)");
  return errors;
}

function auditTab(src) {
  const errors = [];
  if (!src.includes("describeLoadAuditEvent"))
    errors.push("tab: does not build sentences via describeLoadAuditEvent (would render raw codes)");
  for (const col of ["When", "Who", "What happened", "Money", "Opens"]) {
    if (!src.includes(col)) errors.push(`tab: column "${col}" is missing`);
  }
  for (const [id, name] of [
    ["load-audit-from", "Range from"],
    ["load-audit-to", "Range to"],
    ["load-audit-type", "Type"],
    ["load-audit-who", "Who"],
  ]) {
    if (!src.includes(`data-testid="${id}"`)) errors.push(`tab: ${name} filter (${id}) is missing`);
  }
  if (!src.includes("ev.event_class")) errors.push("tab: CSV export does not keep the machine code (ev.event_class)");
  if (!/exportCSV/.test(src)) errors.push("tab: CSV export (exportCSV) is missing");
  if (!src.includes("row.opens.kind") || !src.includes("row.opens.id"))
    errors.push("tab: Opens is not rendered per row from row.opens");
  if (/#[0-9a-fA-F]{3,6}\b/.test(src)) errors.push("tab: a hex colour literal is present — the palette must be .ldt-* tokens only");
  return errors;
}

function auditDrawer(src) {
  const errors = [];
  if (!src.includes("<LoadAuditTab")) errors.push("drawer: the Audit tab does not render LoadAuditTab");
  if (src.includes("EntityAuditHistoryTab"))
    errors.push("drawer: still references the code-printing EntityAuditHistoryTab for the load Audit tab");
  return errors;
}

function run(sent, tab, drawer) {
  return [...auditSentences(sent), ...auditTab(tab), ...auditDrawer(drawer)];
}

const sent = fs.readFileSync(SENT, "utf8");
const tab = fs.readFileSync(TAB, "utf8");
const drawer = fs.readFileSync(DRAWER, "utf8");

if (process.argv.includes("--selftest")) {
  // 1) Row-text validator: a raw code and a block id must both FAIL; a real English row must pass.
  const validatorCases = [
    ["raw code", "dispatch.load_created", true, true],
    ["block id", "Instruction sheets sent BT-3- to driver", true, true],
    ["missing opens", "Load 13526 booked — Uhrichsville → Mesquite", false, true],
    ["good row", "Load 13526 booked — Uhrichsville → Mesquite, JRAYL, driver Sosa Perez, T170", true, false],
  ];
  for (const [label, text, hasOpens, shouldFail] of validatorCases) {
    const failed = validateRowText(text, hasOpens).length > 0;
    if (failed !== shouldFail) {
      console.error(`SELFTEST FAIL — validator wrong on "${label}" (expected ${shouldFail ? "FAIL" : "PASS"})`);
      process.exit(1);
    }
  }

  // 2) Source mutations — each must be caught.
  const mutations = [
    ["sentences: drop humanize fallback", [sent.replaceAll("humanizeAuditEventType(ev.event_class)", "ev.event_class"), tab, drawer]],
    ["sentences: drop RAW_CODE floor", [sent.replaceAll("RAW_CODE_RE", "NOPE_RE"), tab, drawer]],
    ["sentences: allow null opens", [sent.replace('opens: { kind: "load"', "opens: { kind: null"), tab, drawer]],
    ["tab: drop describeLoadAuditEvent", [sent, tab.replaceAll("describeLoadAuditEvent", "nope"), drawer]],
    ["tab: drop What happened column", [sent, tab.replaceAll("What happened", "Action"), drawer]],
    ["tab: drop Type filter", [sent, tab.replace('data-testid="load-audit-type"', 'data-testid="x"'), drawer]],
    ["tab: drop CSV code", [sent, tab.replaceAll("ev.event_class", "nope"), drawer]],
    ["tab: drop Opens render", [sent, tab.replaceAll("row.opens.kind", "nope"), drawer]],
    ["tab: add hex literal", [sent, tab + "\nconst c = '#1f2a44';", drawer]],
    ["drawer: revert to EntityAuditHistoryTab", [sent, tab, drawer.replace("<LoadAuditTab", "<EntityAuditHistoryTab")]],
  ];
  let caught = 0;
  for (const [label, args] of mutations) {
    if (run(...args).length > 0) { caught += 1; continue; }
    console.error(`SELFTEST FAIL — mutation escaped: ${label}`);
    process.exit(1);
  }
  const clean = run(sent, tab, drawer);
  if (clean.length) { console.error(`SELFTEST FAIL — good sources rejected:\n- ${clean.join("\n- ")}`); process.exit(1); }
  console.log(`PASS verify-ldt-7-audit-english --selftest ${caught + validatorCases.length}/${mutations.length + validatorCases.length}`);
  process.exit(0);
}

const failures = run(sent, tab, drawer);
if (failures.length) {
  console.error("FAIL verify-ldt-7-audit-english");
  failures.forEach((f) => console.error(`- ${f}`));
  process.exit(1);
}
console.log("PASS verify-ldt-7-audit-english");
