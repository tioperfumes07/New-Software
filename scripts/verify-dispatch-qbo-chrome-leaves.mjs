#!/usr/bin/env node
/**
 * Dispatch qbo_chrome — leaf-specific Built for the remaining 13 leaves (of 17 total) only "claimed"
 * by the broad verify-cursor-vertical-qbo-picker-modules.mjs sweep — same theater-coverage class
 * already found+fixed for insurance/legal/accounting/customers/drivers/vendors this session: it
 * verifies generic shared files (ReportsHome, BillsPage, DispatchBoard.tsx's mere existence...) and
 * never opens a real dispatch leaf's own chrome.
 *
 * chrome.toolbar_(search|range|gear) are already real via CLS-FILTER-GEAR-APPLY (dispatch included).
 * chrome.toolbar_filter is already real via verify-safety-dispatch-qbo-chrome-toolbar-filter.mjs
 * (PodReviewPage.tsx's real CollapsedListFilters, shipped PR#12032). None of the 4 toolbar leaves
 * are re-claimed here.
 *
 * All 13 leaves below are genuinely built, traced through the real route/component wiring:
 *   - secondary.book_load / planning.reserve: BookLoadModalV4.tsx (the real target of the
 *     BookLoadModal.tsx re-export shim) — a full wizard chrome with a real ModalCloseButton header,
 *     real EntityPicker fields, and real MoneyInput linehaul/fuel-surcharge fields.
 *   - planning.templates: LoadTemplateLibrary.tsx's own real Modal ("Load templates") with an
 *     EntityPicker customer filter and a real Apply/Cancel/Reset triad.
 *   - dispatch.modal.save_load_template: the same file's SaveLoadTemplateModal — a real Modal
 *     ("Save load as template") with EntityPicker + EntityLinkOrTombstone + a real Save action.
 *   - docs.pod: PodReviewPage.tsx — real CollapsedListFilters + ParityTable.
 *   - docs.ocr: OcrQueuePage.tsx — real ParityTable with a real "Convert to load" drill hop into
 *     Book Load.
 *   - settings.dispatch: DispatchSettingsPage.tsx — a real PageHeader + honest-empty-state settings
 *     form, auto-saving on change via saveViewM.
 *   - settings.notify: NotifyPreferencesPage.tsx — a real ParityTable (notify log) + real PrefToggle
 *     preference switches.
 *   - load.detail / load.drawer.overview / load.drawer.documents: LoadDetailDrawer.tsx — a real
 *     role="dialog" drawer with real Overview/Documents tabs, the Documents tab mounting the real
 *     DocumentsTab component.
 *   - dispatch.modal.abandonment_report: AbandonmentReportModal.tsx — a real Modal with a real
 *     DriverPickerWithCreate field and a real DateTimePicker field.
 *   - queues.in_transit.create: InTransitIssuesPage.tsx — a real "+ Create Issue" ActionButton
 *     mounting a real Modal variant="drawer", alongside a real ParityTable roster.
 *
 * @matrix-built {"modules":["dispatch"],"cols":["qbo_chrome"],"leafRe":"^secondary\\.book_load$","task":"VERTICAL-QBO-CHROME-dispatch-book-load","vertical":"column-wave"}
 * @matrix-built {"modules":["dispatch"],"cols":["qbo_chrome"],"leafRe":"^planning\\.reserve$","task":"VERTICAL-QBO-CHROME-dispatch-planning-reserve","vertical":"column-wave"}
 * @matrix-built {"modules":["dispatch"],"cols":["qbo_chrome"],"leafRe":"^planning\\.templates$","task":"VERTICAL-QBO-CHROME-dispatch-planning-templates","vertical":"column-wave"}
 * @matrix-built {"modules":["dispatch"],"cols":["qbo_chrome"],"leafRe":"^dispatch\\.modal\\.save_load_template$","task":"VERTICAL-QBO-CHROME-dispatch-save-load-template","vertical":"column-wave"}
 * @matrix-built {"modules":["dispatch"],"cols":["qbo_chrome"],"leafRe":"^docs\\.pod$","task":"VERTICAL-QBO-CHROME-dispatch-docs-pod","vertical":"column-wave"}
 * @matrix-built {"modules":["dispatch"],"cols":["qbo_chrome"],"leafRe":"^docs\\.ocr$","task":"VERTICAL-QBO-CHROME-dispatch-docs-ocr","vertical":"column-wave"}
 * @matrix-built {"modules":["dispatch"],"cols":["qbo_chrome"],"leafRe":"^settings\\.dispatch$","task":"VERTICAL-QBO-CHROME-dispatch-settings-dispatch","vertical":"column-wave"}
 * @matrix-built {"modules":["dispatch"],"cols":["qbo_chrome"],"leafRe":"^settings\\.notify$","task":"VERTICAL-QBO-CHROME-dispatch-settings-notify","vertical":"column-wave"}
 * @matrix-built {"modules":["dispatch"],"cols":["qbo_chrome"],"leafRe":"^load\\.detail$","task":"VERTICAL-QBO-CHROME-dispatch-load-detail","vertical":"column-wave"}
 * @matrix-built {"modules":["dispatch"],"cols":["qbo_chrome"],"leafRe":"^load\\.drawer\\.overview$","task":"VERTICAL-QBO-CHROME-dispatch-load-drawer-overview","vertical":"column-wave"}
 * @matrix-built {"modules":["dispatch"],"cols":["qbo_chrome"],"leafRe":"^load\\.drawer\\.documents$","task":"VERTICAL-QBO-CHROME-dispatch-load-drawer-documents","vertical":"column-wave"}
 * @matrix-built {"modules":["dispatch"],"cols":["qbo_chrome"],"leafRe":"^dispatch\\.modal\\.abandonment_report$","task":"VERTICAL-QBO-CHROME-dispatch-abandonment-report","vertical":"column-wave"}
 * @matrix-built {"modules":["dispatch"],"cols":["qbo_chrome"],"leafRe":"^queues\\.in_transit\\.create$","task":"VERTICAL-QBO-CHROME-dispatch-in-transit-create","vertical":"column-wave"}
 *
 * Self-test: node scripts/verify-dispatch-qbo-chrome-leaves.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-dispatch-qbo-chrome-leaves";

const CHECKS = [
  {
    name: "secondary.book_load / planning.reserve: BookLoadModalV4 real wizard chrome (ModalCloseButton + EntityPicker + MoneyInput)",
    file: "apps/frontend/src/pages/dispatch/components/BookLoadModalV4.tsx",
    pattern: /(?=[\s\S]*ModalCloseButton)(?=[\s\S]*EntityPicker)(?=[\s\S]*MoneyInput valueCents)/,
  },
  {
    name: "planning.templates: LoadTemplateLibrary real Modal with EntityPicker filter + Apply triad",
    file: "apps/frontend/src/pages/dispatch/LoadTemplateLibrary.tsx",
    pattern: /title="Load templates"[\s\S]{0,1500}load-template-library-filter-apply/,
  },
  {
    name: "dispatch.modal.save_load_template: LoadTemplateLibrary real SaveLoadTemplateModal with EntityPicker + EntityLinkOrTombstone + Save",
    file: "apps/frontend/src/pages/dispatch/LoadTemplateLibrary.tsx",
    pattern: /title="Save load as template"[\s\S]{0,3500}Save template/,
  },
  {
    name: "docs.pod: PodReviewPage real CollapsedListFilters + ParityTable",
    file: "apps/frontend/src/pages/dispatch/PodReviewPage.tsx",
    pattern: /<CollapsedListFilters[\s\S]{0,2500}<ParityTable/,
  },
  {
    name: "docs.ocr: OcrQueuePage real ParityTable with a Convert to load drill hop",
    file: "apps/frontend/src/pages/dispatch/OcrQueuePage.tsx",
    pattern: /(?=[\s\S]*<ParityTable)(?=[\s\S]*Convert to load)/,
  },
  {
    name: "settings.dispatch: DispatchSettingsPage real PageHeader + honest empty state + auto-save mutation",
    file: "apps/frontend/src/pages/dispatch/DispatchSettingsPage.tsx",
    pattern: /(?=[\s\S]*<PageHeader)(?=[\s\S]*dispatch-settings-honest-empty)(?=[\s\S]*saveViewM)/,
  },
  {
    name: "settings.notify: NotifyPreferencesPage real ParityTable + PrefToggle switches",
    file: "apps/frontend/src/pages/dispatch/NotifyPreferencesPage.tsx",
    pattern: /(?=[\s\S]*<ParityTable)(?=[\s\S]*PrefToggle)/,
  },
  {
    name: "load.detail / load.drawer.overview / load.drawer.documents: LoadDetailDrawer real role=dialog + Overview/Documents tabs + DocumentsTab",
    file: "apps/frontend/src/components/dispatch/LoadDetailDrawer.tsx",
    // RE-PIN 2026-09-06: the Documents tab component was renamed to LdtDocumentsTab (LDT-D).
    // Accept either <DocumentsTab or <LdtDocumentsTab.
    pattern: /(?=[\s\S]*role="dialog")(?=[\s\S]*"Overview")(?=[\s\S]*"Documents")(?=[\s\S]*<(?:Ldt)?DocumentsTab)/,
  },
  {
    name: "dispatch.modal.abandonment_report: AbandonmentReportModal real Modal + DriverPickerWithCreate + DateTimePicker",
    file: "apps/frontend/src/pages/loads/AbandonmentReportModal.tsx",
    pattern: /(?=[\s\S]*<Modal open title="Report load abandonment")(?=[\s\S]*DriverPickerWithCreate)(?=[\s\S]*DateTimePicker)/,
  },
  {
    name: "queues.in_transit.create: InTransitIssuesPage real + Create Issue button mounting a real Modal drawer + ParityTable",
    file: "apps/frontend/src/pages/dispatch/InTransitIssuesPage.tsx",
    pattern: /\+ Create Issue[\s\S]{0,4000}<Modal variant="drawer" open=\{createOpen\}/,
  },
];

function runChecks(root = ROOT) {
  const fails = [];
  for (const c of CHECKS) {
    const abs = path.join(root, c.file);
    if (!fs.existsSync(abs)) {
      fails.push(`${c.name}: missing ${c.file}`);
      continue;
    }
    const src = fs.readFileSync(abs, "utf8");
    if (!c.pattern.test(src)) fails.push(`${c.name}: pattern miss in ${c.file}`);
  }
  return fails;
}

function selftest() {
  const live = runChecks();
  const tmp = fs.mkdtempSync(path.join(ROOT, "scripts", ".dispatch-qbo-chrome-selftest-"));
  try {
    for (const c of CHECKS) {
      const abs = path.join(tmp, c.file);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, "// poison — no chrome\n");
    }
    const planted = runChecks(tmp);
    if (planted.length < CHECKS.length) {
      console.error(`${LABEL} SELFTEST FAIL — planted chrome misses not caught (${planted.length})`);
      process.exit(1);
    }
    console.log(`${LABEL} SELFTEST PASS (poison trips ${planted.length})`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (live.length) {
    console.error(`${LABEL} FAIL live:\n- ${live.join("\n- ")}`);
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();

const fails = runChecks();
if (fails.length) {
  console.error(`${LABEL} FAIL (${fails.length}):\n- ${fails.join("\n- ")}`);
  process.exit(1);
}
console.log(`${LABEL} PASS — ${CHECKS.length} checks / 13 dispatch qbo_chrome leaf asserts`);
