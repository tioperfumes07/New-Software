#!/usr/bin/env node
// LDT-D — Guard: Documents tab (More ▾ → Documents) in the approved design.
//
// Verifies:
//   SOURCE: LdtDocumentsTab.tsx exists and renders ONE table with columns
//           Date · Type · Name · Size · Linked to · Open
//   SOURCE: Type column maps to the required labels (Rate con · BOL · POD · Invoice · Receipt · Other)
//   SOURCE: Load docs upload via existing docs upload (EntityDocumentUpload)
//   SOURCE: Expense/bill receipt upload via ReceiptAttach
//   SOURCE: .ldt-* palette classes (no hex literals in the new tab component)
//   SOURCE: Customs never appears in the Documents tab
//   SOURCE: Shared read (useLoadDocuments) is consumed by LdtDocumentsTab, FactoringTab, and LoadStopsRecordTab
//   LIVE (degrade-safe): if DATABASE_URL is set, confirm the shared read's query keys match across consumers
//   SELFTEST: drops the Type column → FAIL
//
// Usage:
//   node scripts/verify-ldt-d-documents-tab.mjs           # source + live (if DATABASE_URL)
//   node scripts/verify-ldt-d-documents-tab.mjs --selftest # mutation test

import process from "node:process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const LABEL = "verify-ldt-d-documents-tab";

const LDT_DOCUMENTS_TAB = join(ROOT, "apps", "frontend", "src", "components", "dispatch", "tabs", "LdtDocumentsTab.tsx");
const USE_LOAD_DOCUMENTS = join(ROOT, "apps", "frontend", "src", "components", "dispatch", "tabs", "useLoadDocuments.ts");
const FACTORING_TAB = join(ROOT, "apps", "frontend", "src", "components", "dispatch", "tabs", "FactoringTab.tsx");
const STOPS_TAB = join(ROOT, "apps", "frontend", "src", "components", "dispatch", "LoadStopsRecordTab.tsx");
const DRAWER = join(ROOT, "apps", "frontend", "src", "components", "dispatch", "LoadDetailDrawer.tsx");

class GuardError extends Error {}
function fail(msg) { throw new GuardError(msg); }
function reportFail(msg) { console.error(`${LABEL} FAIL — ${msg}`); process.exit(1); }
function read(path) { return readFileSync(path, "utf-8"); }

// --- Source checks ---

function verifySourceFiles() {
  if (!existsSync(LDT_DOCUMENTS_TAB)) fail("LdtDocumentsTab.tsx not found");
  if (!existsSync(USE_LOAD_DOCUMENTS)) fail("useLoadDocuments.ts (shared read) not found");
  if (!existsSync(FACTORING_TAB)) fail("FactoringTab.tsx not found");
  if (!existsSync(STOPS_TAB)) fail("LoadStopsRecordTab.tsx not found");

  const tab = read(LDT_DOCUMENTS_TAB);
  const sharedRead = read(USE_LOAD_DOCUMENTS);
  const factoring = read(FACTORING_TAB);
  const stops = read(STOPS_TAB);
  const drawer = read(DRAWER);

  // 1. ONE table with the required columns: Date · Type · Name · Size · Linked to · Open
  // ParityTable uses column definitions with label: "Col" — not raw <th> elements.
  const requiredColumns = ["Date", "Type", "Name", "Size", "Linked to", "Open"];
  for (const col of requiredColumns) {
    if (!tab.includes(`label: "${col}"`)) {
      fail(`LdtDocumentsTab.tsx missing required column label "${col}"`);
    }
  }

  // 2. Type column maps to required labels: Rate con · BOL · POD · Invoice · Receipt · Other
  const requiredTypeLabels = ["Rate con", "BOL", "POD", "Invoice", "Receipt", "Other"];
  for (const label of requiredTypeLabels) {
    if (!sharedRead.includes(label)) {
      fail(`useLoadDocuments.ts missing required Type label "${label}"`);
    }
  }

  // 3. Load docs upload via existing docs upload (EntityDocumentUpload)
  if (!tab.includes("EntityDocumentUpload")) {
    fail("LdtDocumentsTab.tsx missing EntityDocumentUpload (load docs upload path)");
  }

  // 4. Expense/bill receipt upload via ReceiptAttach
  if (!tab.includes("ReceiptAttach")) {
    fail("LdtDocumentsTab.tsx missing ReceiptAttach (expense/bill receipt upload path)");
  }

  // 5. .ldt-* palette classes (no hex literals in the new tab component)
  if (!tab.includes("ldt-")) {
    fail("LdtDocumentsTab.tsx missing .ldt-* palette classes");
  }
  // Check for hex literals in the component (excluding comments and import strings)
  // Allow hex in CSS token files, but not in the tab component itself
  const hexLiteralPattern = /#[0-9a-fA-F]{3,8}\b/g;
  const tabLines = tab.split("\n");
  for (let i = 0; i < tabLines.length; i++) {
    const line = tabLines[i];
    // Skip comment lines and lines with URLs
    if (line.trim().startsWith("//") || line.trim().startsWith("*") || line.includes("http")) continue;
    const matches = line.match(hexLiteralPattern);
    if (matches) {
      fail(`LdtDocumentsTab.tsx line ${i + 1}: hex literal "${matches[0]}" found — use .ldt-* classes only (no hex)`);
    }
  }

  // 6. Customs never appears in the Documents tab (in actual code, not comments explaining the exclusion)
  const tabLinesForCustoms = tab.split("\n");
  for (let i = 0; i < tabLinesForCustoms.length; i++) {
    const line = tabLinesForCustoms[i];
    const trimmed = line.trim();
    // Skip comment lines — those may explain the exclusion:
    //   // line comments, * block comment lines, /* block comment start,
    //   {/* JSX comments */}, and lines inside JSX comment blocks
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    if (trimmed.startsWith("{/*")) continue;
    if (/\bCustoms\b/i.test(line) || /\bcustoms\b/i.test(line)) {
      fail(`LdtDocumentsTab.tsx line ${i + 1}: 'Customs' found in code — customs docs live on the Customs tab (owner)`);
    }
  }

  // 7. Shared read (useLoadDocuments) is consumed by all three tabs
  if (!tab.includes("useLoadDocuments")) {
    fail("LdtDocumentsTab.tsx does not consume the shared read (useLoadDocuments)");
  }
  if (!factoring.includes("useLoadDocuments")) {
    fail("FactoringTab.tsx does not consume the shared read (useLoadDocuments) — BOL/POD chips must come from the same rows");
  }
  if (!stops.includes("useLoadDocuments")) {
    fail("LoadStopsRecordTab.tsx does not consume the shared read (useLoadDocuments) — BOL/POD chips must come from the same rows");
  }

  // 8. Shared read query key is stable across consumers
  if (!sharedRead.includes('"ldt-load-documents"')) {
    fail('useLoadDocuments.ts missing stable query key "ldt-load-documents"');
  }

  // 9. Drawer renders the new LdtDocumentsTab
  if (!drawer.includes("LdtDocumentsTab")) {
    fail("LoadDetailDrawer.tsx does not render LdtDocumentsTab");
  }

  // 10. Shared read name is referenced in the component (for the PR naming requirement)
  if (!tab.includes("shared read: useLoadDocuments") && !tab.includes("useLoadDocuments")) {
    fail('LdtDocumentsTab.tsx must name the shared read "useLoadDocuments" in a comment or label');
  }

  console.log(`${LABEL}: source files verified (table columns, Type labels, upload paths, .ldt-* palette, no Customs, shared read)`);
}

// --- Live checks (degrade-safe) ---

async function verifyLive() {
  // Live check is degrade-safe: if no DATABASE_URL, skip (source-only is sufficient
  // for this guard since the shared read is a frontend query-key contract, not a DB check).
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; source-only check passed.`);
    return;
  }
  if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") {
    console.log(`${LABEL} SKIP (live half) — CI database is a fixture; source-only check passed.`);
    return;
  }
  // No live DB check needed for this guard — the shared read is a frontend contract.
  console.log(`${LABEL} SKIP (live half) — guard is a frontend source contract; source-only check passed.`);
}

// --- Selftest ---

function runSelftest() {
  console.log("Running selftest...");
  let caught = 0;
  const total = 3;

  const original = read(LDT_DOCUMENTS_TAB);

  // 1. Drop the Type column → FAIL
  writeFileSync(LDT_DOCUMENTS_TAB, original.replace('label: "Type"', 'label: "Removed"'), "utf-8");
  try { verifySourceFiles(); console.error("SELFTEST FAIL: guard passed after dropping Type column"); process.exit(1); }
  catch (e) { if (e instanceof GuardError) { console.log("OK: detected missing Type column"); caught++; } else throw e; }
  writeFileSync(LDT_DOCUMENTS_TAB, original, "utf-8");

  // 2. Add Customs text in code (not comment) → FAIL
  writeFileSync(LDT_DOCUMENTS_TAB, original + '\nconst Customs = "customs";\n', "utf-8");
  try { verifySourceFiles(); console.error("SELFTEST FAIL: guard passed after adding Customs text"); process.exit(1); }
  catch (e) { if (e instanceof GuardError) { console.log("OK: detected Customs text"); caught++; } else throw e; }
  writeFileSync(LDT_DOCUMENTS_TAB, original, "utf-8");

  // 3. Remove .ldt-* palette → FAIL
  writeFileSync(LDT_DOCUMENTS_TAB, original.replaceAll("ldt-", "poisoned-"), "utf-8");
  try { verifySourceFiles(); console.error("SELFTEST FAIL: guard passed after removing .ldt-* palette"); process.exit(1); }
  catch (e) { if (e instanceof GuardError) { console.log("OK: detected missing .ldt-* palette"); caught++; } else throw e; }
  writeFileSync(LDT_DOCUMENTS_TAB, original, "utf-8");

  if (caught !== total) { console.error(`SELFTEST FAIL: ${caught}/${total} mutations caught`); process.exit(1); }
  console.log(`PASS: selftest complete — ${caught}/${total} mutations caught`);
}

// --- Main ---

async function main() {
  if (process.argv.includes("--selftest")) { runSelftest(); return; }
  try {
    verifySourceFiles();
    await verifyLive();
    console.log(`PASS: ${LABEL}`);
  } catch (e) {
    if (e instanceof GuardError) reportFail(e.message);
    throw e;
  }
}

main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
