#!/usr/bin/env node
/**
 * verify-list-edit-in-drawer.mjs — CUR-2 guard (owner ruling 2026-09-05, inventory row 50):
 * "when editing, maybe it should be edited in a side modal, not full page, just like in QuickBooks."
 *
 * MEASURED DEFECT (before fix): apps/frontend/src/pages/Customers.tsx and Vendors.tsx wired the list
 * "Edit" button to `navigate('/customers/:id')` / `navigate('/vendors/:id')` — a full-page hop.
 *
 * REQUIRED VALUE: the list Edit button opens the edit form inside the app's ParityDrawer (the QBO-style
 * right side panel), pre-filled, Save = the SAME PATCH endpoint (updateCustomer / updateVendor), and the
 * full-page route stays reachable by URL (additive). This guard fails if any Edit button reverts to
 * navigating to the full-page edit form, or if a drawer stops using ParityDrawer / the PATCH endpoint.
 *
 * The vendor drawer must NOT send `notes` (that column carries the serialized contact/quality meta blob
 * edited on the full detail page — omitting it in the PATCH preserves it), so the guard forbids a
 * `notes:` payload key in VendorEditDrawer.
 *
 * Usage:
 *   node scripts/verify-list-edit-in-drawer.mjs            # verify the live tree
 *   node scripts/verify-list-edit-in-drawer.mjs --selftest # planted-defect self-test (must catch each)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const FILES = {
  customersPage: "apps/frontend/src/pages/Customers.tsx",
  vendorsPage: "apps/frontend/src/pages/Vendors.tsx",
  customerDrawer: "apps/frontend/src/components/customers/CustomerEditDrawer.tsx",
  vendorDrawer: "apps/frontend/src/components/vendors/VendorEditDrawer.tsx",
};

/** Return the ~400-char window immediately BEFORE a data-testid attribute (its element's props). */
function propsBeforeTestid(src, testid) {
  const marker = `data-testid="${testid}"`;
  const idx = src.indexOf(marker);
  if (idx === -1) return null;
  return src.slice(Math.max(0, idx - 400), idx);
}

/**
 * Assert the given list page routes its Edit button to a drawer, not a full-page navigate.
 * `entity` = "customers" | "vendors"; `testid` = the Edit button test id; `opener` = the state setter
 * that opens the drawer; `drawer` = the drawer component name.
 * Returns an array of failure strings (empty = pass).
 */
export function checkListPage({ src, entity, testid, opener, drawer }) {
  const fails = [];
  if (!src.includes(`import { ${drawer} }`) && !new RegExp(`import\\s*\\{[^}]*\\b${drawer}\\b`).test(src)) {
    fails.push(`${entity} page does not import ${drawer}`);
  }
  if (!src.includes(`<${drawer}`)) {
    fails.push(`${entity} page does not render <${drawer}>`);
  }
  const props = propsBeforeTestid(src, testid);
  if (props == null) {
    fails.push(`${entity} page has no Edit button with data-testid="${testid}"`);
  } else {
    if (!props.includes(`${opener}(`)) {
      fails.push(`${entity} Edit button (${testid}) does not open the drawer via ${opener}(...)`);
    }
    // The Edit button must NOT navigate to the full-page edit form.
    if (new RegExp(`navigate\\(\`/${entity}/`).test(props)) {
      fails.push(`${entity} Edit button (${testid}) still navigates to the full-page form`);
    }
  }
  return fails;
}

/** Assert an edit drawer is hosted in ParityDrawer and saves via the given PATCH endpoint. */
export function checkDrawer({ src, name, endpoint, forbidNotesKey = false }) {
  const fails = [];
  if (!src.includes("<ParityDrawer")) fails.push(`${name} does not render <ParityDrawer>`);
  if (!src.includes(`${endpoint}(`)) fails.push(`${name} does not call the ${endpoint} PATCH endpoint`);
  if (!src.includes("confirmDiscardOnClose")) fails.push(`${name} does not set confirmDiscardOnClose (unsaved-changes prompt)`);
  if (forbidNotesKey && /\bnotes\s*:/.test(src)) {
    fails.push(`${name} sends a notes: key — it must omit notes to preserve the vendor meta/contacts blob`);
  }
  return fails;
}

function runChecks(sources) {
  const fails = [];
  fails.push(
    ...checkListPage({
      src: sources.customersPage,
      entity: "customers",
      testid: "customer-header-edit",
      opener: "setEditDrawerCustomer",
      drawer: "CustomerEditDrawer",
    })
  );
  fails.push(
    ...checkListPage({
      src: sources.vendorsPage,
      entity: "vendors",
      testid: "vendor-header-edit",
      opener: "setEditVendorId",
      drawer: "VendorEditDrawer",
    })
  );
  fails.push(...checkDrawer({ src: sources.customerDrawer, name: "CustomerEditDrawer", endpoint: "updateCustomer" }));
  fails.push(
    ...checkDrawer({ src: sources.vendorDrawer, name: "VendorEditDrawer", endpoint: "updateVendor", forbidNotesKey: true })
  );
  return fails;
}

function readAll() {
  const out = {};
  for (const [k, rel] of Object.entries(FILES)) out[k] = readFileSync(join(ROOT, rel), "utf8");
  return out;
}

function selftest() {
  let planted = 0;
  let caught = 0;
  const good = readAll();

  // Baseline must pass.
  const baseFails = runChecks(good);
  if (baseFails.length) {
    console.error("SELFTEST baseline unexpectedly failed:");
    for (const f of baseFails) console.error("  - " + f);
    process.exit(1);
  }

  const plant = (mutate, label) => {
    planted++;
    const s = { ...good, ...mutate(good) };
    const fails = runChecks(s);
    if (fails.length > 0) {
      caught++;
    } else {
      console.error(`SELFTEST MISS: planted defect not caught -> ${label}`);
    }
  };

  // 1. Customers Edit button reverts to full-page navigate.
  plant(
    (g) => ({
      customersPage: g.customersPage.replace(
        'onClick={() => setEditDrawerCustomer(selectedCustomer)}\n                        data-testid="customer-header-edit"',
        'onClick={() => navigate(`/customers/${selectedCustomer.id}`)}\n                        data-testid="customer-header-edit"'
      ),
    }),
    "customers edit -> navigate full page"
  );

  // 2. Vendors Edit button reverts to full-page navigate.
  plant(
    (g) => ({
      vendorsPage: g.vendorsPage.replace(
        'onClick={() => setEditVendorId(selectedVendor.id)}\n                        data-testid="vendor-header-edit"',
        'onClick={() => navigate(`/vendors/${selectedVendor.id}`)}\n                        data-testid="vendor-header-edit"'
      ),
    }),
    "vendors edit -> navigate full page"
  );

  // 3. Customers page drops the drawer render entirely.
  plant((g) => ({ customersPage: g.customersPage.replace("<CustomerEditDrawer", "<DisabledCustomerEditDrawer") }), "customers drawer removed");

  // 4. Vendor drawer stops using ParityDrawer.
  plant((g) => ({ vendorDrawer: g.vendorDrawer.replace(/<ParityDrawer/g, "<CenteredModal") }), "vendor drawer not ParityDrawer");

  // 5. Vendor drawer starts sending a notes: key (would clobber the meta blob).
  plant(
    (g) => ({ vendorDrawer: g.vendorDrawer.replace("operating_company_id: companyId || undefined,", "notes: values.name,\n        operating_company_id: companyId || undefined,") }),
    "vendor drawer sends notes key"
  );

  // 6. Customer drawer stops calling the PATCH endpoint.
  plant((g) => ({ customerDrawer: g.customerDrawer.replace(/updateCustomer\(/g, "noopUpdate(") }), "customer drawer no PATCH");

  console.log(`SELFTEST: ${caught}/${planted} planted defects caught.`);
  if (caught !== planted) process.exit(1);
  console.log("verify-list-edit-in-drawer --selftest OK");
}

function main() {
  if (process.argv.includes("--selftest")) return selftest();
  const fails = runChecks(readAll());
  if (fails.length) {
    console.error("verify-list-edit-in-drawer FAILED:");
    for (const f of fails) console.error("  - " + f);
    process.exit(1);
  }
  console.log("verify-list-edit-in-drawer OK — Customers & Vendors Edit open ParityDrawer; full-page route additive-only.");
}

main();
