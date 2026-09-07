#!/usr/bin/env node
/** @matrix-built {"modules":["dispatch"],"cols":["qbo_chrome"],"leafRe":"^dispatch\\.modal\\.book_load_modal_v4$","task":"AUTHGATE-PANEL-MISSING-ENTITY-LABELS"}
 *
 * U6 item 3/3: BookLoadModalV4 renders <AuthGatePanel> with unitUuid/driverUuid/trailerUuid but
 * never passed the panel's own optional unitLabel/driverLabel/trailerLabel props — so
 * EntityLinkOrTombstone inside AuthGatePanel always fell back to id-only ("Unit — not visible")
 * even though BookLoadEquipmentSection (a sibling in the same tree) already resolves the real
 * label the moment a unit/trailer/driver is picked. Fixed by lifting the resolved
 * EntityPickerOption up via a new onOptionsResolved callback and threading the labels into
 * AuthGatePanel.
 *
 * RE-PIN 2026-09-06: the trailer variable name was relaxed from the literal `trailerOption` to
 * any identifier (\w+) because the code evolved to use `trailerForGate` (which resolves to the
 * interchange trailer when in interchange mode) instead of the raw `trailerOption`. The contract
 * is that onOptionsResolved receives a trailer option — the variable name is an implementation
 * detail, not the contract.
 */
import fs from "node:fs";
const LABEL = "verify-book-load-authgate-entity-labels";
const MODAL_FILE = "apps/frontend/src/pages/dispatch/components/BookLoadModalV4.tsx";
const SECTION_FILE = "apps/frontend/src/pages/dispatch/components/BookLoadEquipmentSection.tsx";

function audit(modalSrc, sectionSrc) {
  const failures = [];
  // Anchor on a real prop, not just "<AuthGatePanel" — a doc comment above the real JSX usage also
  // contains the literal text "<AuthGatePanel>" and would otherwise be matched instead.
  const authGateBlock = modalSrc.match(/<AuthGatePanel\s*\n\s*operatingCompanyId=\{operatingCompanyId\}[\s\S]*?\/>/)?.[0] ?? "";
  if (!authGateBlock) {
    failures.push("could not find the <AuthGatePanel ... /> usage in BookLoadModalV4.tsx");
    return failures;
  }
  for (const prop of ["unitLabel", "driverLabel", "trailerLabel"]) {
    if (!new RegExp(`${prop}=`).test(authGateBlock)) {
      failures.push(`<AuthGatePanel> must pass ${prop}, not just the matching *Uuid prop`);
    }
  }
  if (!/onOptionsResolved=\{setEquipmentOptions\}/.test(modalSrc)) {
    failures.push("BookLoadModalV4 must wire onOptionsResolved={setEquipmentOptions} on <BookLoadEquipmentSection>");
  }
  if (!/onOptionsResolved\?\.\(\{\s*unit:\s*unitOption,\s*trailer:\s*\w+,\s*primaryDriver:\s*primaryDriverOption,?\s*\}\);?/.test(sectionSrc)) {
    failures.push("BookLoadEquipmentSection must call onOptionsResolved with the resolved unit/trailer/primaryDriver options");
  }
  return failures;
}

if (process.argv.includes("--selftest")) {
  const modalSrc = fs.readFileSync(MODAL_FILE, "utf8");
  const sectionSrc = fs.readFileSync(SECTION_FILE, "utf8");
  const mutations = [
    ["strip-unitLabel-prop", (m) => m.replace(/\s*unitLabel=\{equipmentOptions\.unit\?\.label \?\? null\}\n/g, "\n")],
    ["strip-lift-up-callback", (_m, s) => s.replace(/onOptionsResolved\?\.\(\{[\s\S]*?\}\);/, "")],
  ];
  for (const [name, mutate] of mutations) {
    const candidateModal = name === "strip-unitLabel-prop" ? mutate(modalSrc) : modalSrc;
    const candidateSection = name === "strip-lift-up-callback" ? mutate(modalSrc, sectionSrc) : sectionSrc;
    if (
      (candidateModal === modalSrc && candidateSection === sectionSrc) ||
      audit(candidateModal, candidateSection).length === 0
    ) {
      console.error(`${LABEL} SELFTEST FAIL — ${name}`);
      process.exit(1);
    }
  }
  console.log(`${LABEL} SELFTEST PASS — ${mutations.length} mutations detected`);
  process.exit(0);
}

const failures = audit(fs.readFileSync(MODAL_FILE, "utf8"), fs.readFileSync(SECTION_FILE, "utf8"));
if (failures.length) {
  console.error(`${LABEL} FAIL\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`${LABEL} PASS — BookLoadModalV4's AuthGatePanel receives real unit/driver/trailer labels, not id-only`);
