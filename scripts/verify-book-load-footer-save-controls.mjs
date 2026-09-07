#!/usr/bin/env node
// WIZ-49 — Book Load / Edit Load footer save controls guard.
//
// Locks the three additive footer affordances the owner ordered, so they can never silently
// regress:
//   a) QuickBooks-style split Save (SaveDropdown) with "Save and close" + "Save and print" wired.
//   b) A Print control wired to the ONE existing dispatch-sheet PDF path (openPrintableDocument on
//      /dispatch/loads/:id/dispatch-sheet.html) — never a new PDF path.
//   c) An in-modal, aria-live save-confirmation banner (the page-level toast renders behind the
//      wizard, so the operator inside it never sees it).
//   d) "Save and send" IS wired to the one real send (onSaveAndSend) — WIZ-49d resolved by owner
//      order 2026-09-04 item 5 "enable Book and send" (#20456).
//
// Exit 1 on any missing contract; exit 0 when all hold.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const MODAL = resolve(root, "apps/frontend/src/pages/dispatch/components/BookLoadModalV4.tsx");
const DROPDOWN = resolve(root, "apps/frontend/src/components/forms/SaveDropdown.tsx");

const errors = [];
function must(cond, msg) {
  if (!cond) errors.push(msg);
}

let modal;
let dropdown;
try {
  modal = readFileSync(MODAL, "utf8");
} catch {
  console.error(`E_NO_MODAL: cannot read ${MODAL}`);
  process.exit(1);
}
try {
  dropdown = readFileSync(DROPDOWN, "utf8");
} catch {
  console.error(`E_NO_DROPDOWN: cannot read ${DROPDOWN}`);
  process.exit(1);
}

// (a) split Save
must(/import\s+\{\s*SaveDropdown\s*\}/.test(modal), "MISSING: BookLoadModalV4 must import SaveDropdown");
must(/<SaveDropdown\b/.test(modal), "MISSING: footer must render <SaveDropdown> (QuickBooks split save)");
must(/onSaveAndClose=\{/.test(modal), "MISSING: SaveDropdown must wire onSaveAndClose");
must(/onSaveAndPrint=\{/.test(modal), "MISSING: SaveDropdown must wire onSaveAndPrint");

// (a2) Owner's EXACT split-control words (2026-09-04): primary "Book + dispatch"; caret
// "Book and dispatch / Book and save / Book and print / Book and send". Lock them so the labels
// can never regress to the generic "Save and close / Save and print".
must(modal.includes('"Book + dispatch"'), 'MISSING: primary label must be "Book + dispatch"');
must(/menuLabels=/.test(modal), "MISSING: SaveDropdown must pass menuLabels with the owner's Book words");
for (const label of ["Book and dispatch", "Book and save", "Book and print", "Book and send"]) {
  must(modal.includes(`"${label}"`), `MISSING: caret menu must carry the owner's label "${label}"`);
}
// SaveDropdown must actually honor per-usage menu label overrides.
must(/menuLabels\??:/.test(dropdown), "MISSING: SaveDropdown must accept a menuLabels override prop");
must(/item\.menuLabel\s*\?\?\s*item\.label/.test(dropdown), "MISSING: SaveDropdown must render menuLabel over label in the caret menu");

// (b) Print → existing dispatch-sheet path, no new PDF route
must(
  /import\s+\{\s*openPrintableDocument\s*\}/.test(modal),
  "MISSING: BookLoadModalV4 must import openPrintableDocument (reuse the existing print path)"
);
must(
  /dispatch\/loads\/\$\{encodeURIComponent\([^)]*\)\}\/dispatch-sheet\.html/.test(modal),
  "MISSING: Print must target the existing /dispatch/loads/:id/dispatch-sheet.html path — no new PDF path"
);
must(
  /data-testid="book-load-print-dispatch-sheet"/.test(modal),
  "MISSING: footer must render the standalone Print control (data-testid book-load-print-dispatch-sheet)"
);

// (c) in-modal confirmation
must(
  /data-testid="book-load-save-confirmation-banner"/.test(modal),
  "MISSING: an in-modal save-confirmation banner (data-testid book-load-save-confirmation-banner)"
);
must(
  /book-load-save-confirmation-banner"[\s\S]{0,200}aria-live=/.test(modal),
  "MISSING: the in-modal save banner must be aria-live so it is announced inside the modal"
);

// (d) WIZ-49d RESOLVED — owner order 2026-09-04 item 5 "enable Book and send" (#20456, 0aca76377d).
// The hold is lifted: "Save and send" is WIRED to the one real send path (onSaveAndSend) and is no
// longer a disabled placeholder. The pre-ruling pins (disabled reason present / send forbidden)
// enforced the retracted state and reddened CI (ENV-CENSUS-FAIL, lead re-pin 2026-09-06).
must(
  /onSaveAndSend=\{/.test(modal),
  "MISSING: 'Save and send' must be wired (onSaveAndSend) — owner order 2026-09-04 item 5 enabled Book and send (WIZ-49d resolved)"
);
must(
  !/saveAndSendDisabledReason=\{?["'`][^"'`]*(pending|hold|WIZ-49d)/i.test(modal),
  "FORBIDDEN: 'Save and send' still carries a pending-ruling disabled reason — the WIZ-49d hold was lifted 2026-09-04"
);

// SaveDropdown must actually support the disabled 'Save and send' contract.
must(
  /saveAndSendDisabledReason/.test(dropdown),
  "MISSING: SaveDropdown must support saveAndSendDisabledReason (disabled 'Save and send' placeholder)"
);

if (errors.length) {
  console.error("verify-book-load-footer-save-controls: FAIL");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("verify-book-load-footer-save-controls: PASS (split save + print + in-modal ack; Book and send wired per owner order 2026-09-04)");
process.exit(0);
