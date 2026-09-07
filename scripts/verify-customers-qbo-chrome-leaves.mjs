#!/usr/bin/env node
/** @matrix-built {"modules":["customers"],"cols":["connectivity"],"leaves":["md.customer_details","customers.modal.customer_drill","customers.modal.customer_edit","customers.modal.fmcsaverification"],"task":"CUST-F5922-MODAL-DETAIL-CONNECTIVITY-EXACT","vertical":"class-sweep"} */
/**
 * Customers qbo_chrome — leaf-specific Built for the 17 leaves only "claimed" by the broad
 * verify-cursor-vertical-qbo-picker-modules.mjs sweep (leafRe: ^(chrome|customers|detail|home|list|
 * md)(\.|$)) — same theater-coverage class already found+fixed for insurance/legal/accounting this
 * session: it verifies generic shared files (ReportsHome, RunnerFilters, BillsPage...) and never
 * opens a customers file. chrome.toolbar_(search|range|gear|filter) are already real
 * (CLS-FILTER-GEAR-APPLY + CODEX-ZERO-REMAINDER-PROTECTED-CHROME-7, both include customers).
 * list.view_list is already real (FE-INVARIANT23-LIST-VIEW-SINGLE-LINE-NAME).
 *
 * All 17 leaves are genuinely built, traced through the real route/component wiring:
 *   - list.view_master_detail / list.create / list.filters: Customers.tsx is the single top-level
 *     page for both the master-detail layout and the CustomersListView list mode; its own
 *     "+ Create Customer" ActionButton opens a real Modal variant="drawer", and CustomersListView.tsx
 *     carries the real CollapsedListFilters + ParityTable chrome.
 *   - md.transaction_list: Customers.tsx's own ?tab=transaction_list section (real ParityTable).
 *   - md.customer_details: Customers.tsx's own ?tab=customer_details section renders the local
 *     CustomerDetailsTab component — a real DetailRow-grid detail view with EntityLinkOrTombstone
 *     (factoring company vendor link) and a real Edit action button (opens the CustomerEditModal
 *     covered by detail.edit below); it deliberately has no DatePicker/MoneyInput fields of its own.
 *   - md.new_transaction: Customers.tsx navigates to /accounting/invoices?customer_id=, the real,
 *     already-verified InvoicesListPage.tsx (this session's accounting sweep).
 *   - detail.profile / detail.billing / detail.billing.record_payment / detail.quality.create_event /
 *     detail.lanes.create / detail.contacts.create / detail.edit / detail.fmcsa_verify /
 *     customers.modal.customer_edit / customers.modal.fmcsaverification: all live inside the one
 *     CustomerDetail.tsx tabbed page — real DatePicker/MoneyInput inline fields (billing record
 *     payment), real Modal variant="drawer" create panels (Lane, Contact, Quality Event), and the
 *     real CustomerEditModal / FMCSAVerificationModal components mounted directly.
 *   - customers.modal.customer_drill: CustomerDrillModal.tsx, a real Modal.
 *
 * @matrix-built {"modules":["customers"],"cols":["qbo_chrome"],"leafRe":"^list\\.view_master_detail$","task":"VERTICAL-QBO-CHROME-customers-list-master-detail","vertical":"column-wave"}
 * @matrix-built {"modules":["customers"],"cols":["qbo_chrome"],"leafRe":"^list\\.create$","task":"VERTICAL-QBO-CHROME-customers-list-create","vertical":"column-wave"}
 * @matrix-built {"modules":["customers"],"cols":["qbo_chrome"],"leafRe":"^list\\.filters$","task":"VERTICAL-QBO-CHROME-customers-list-filters","vertical":"column-wave"}
 * @matrix-built {"modules":["customers"],"cols":["qbo_chrome"],"leafRe":"^md\\.transaction_list$","task":"VERTICAL-QBO-CHROME-customers-md-transaction-list","vertical":"column-wave"}
 * @matrix-built {"modules":["customers"],"cols":["qbo_chrome"],"leafRe":"^md\\.customer_details$","task":"VERTICAL-QBO-CHROME-customers-md-customer-details","vertical":"column-wave"}
 * @matrix-built {"modules":["customers"],"cols":["qbo_chrome"],"leafRe":"^md\\.new_transaction$","task":"VERTICAL-QBO-CHROME-customers-md-new-transaction","vertical":"column-wave"}
 * @matrix-built {"modules":["customers"],"cols":["qbo_chrome"],"leafRe":"^detail\\.profile$","task":"VERTICAL-QBO-CHROME-customers-detail-profile","vertical":"column-wave"}
 * @matrix-built {"modules":["customers"],"cols":["qbo_chrome"],"leafRe":"^detail\\.contacts\\.create$","task":"VERTICAL-QBO-CHROME-customers-contacts-create","vertical":"column-wave"}
 * @matrix-built {"modules":["customers"],"cols":["qbo_chrome"],"leafRe":"^detail\\.billing$","task":"VERTICAL-QBO-CHROME-customers-detail-billing","vertical":"column-wave"}
 * @matrix-built {"modules":["customers"],"cols":["qbo_chrome"],"leafRe":"^detail\\.billing\\.record_payment$","task":"VERTICAL-QBO-CHROME-customers-billing-record-payment","vertical":"column-wave"}
 * @matrix-built {"modules":["customers"],"cols":["qbo_chrome"],"leafRe":"^detail\\.quality\\.create_event$","task":"VERTICAL-QBO-CHROME-customers-quality-create-event","vertical":"column-wave"}
 * @matrix-built {"modules":["customers"],"cols":["qbo_chrome"],"leafRe":"^detail\\.lanes\\.create$","task":"VERTICAL-QBO-CHROME-customers-lanes-create","vertical":"column-wave"}
 * @matrix-built {"modules":["customers"],"cols":["qbo_chrome"],"leafRe":"^(detail\\.edit|customers\\.modal\\.customer_edit)$","task":"VERTICAL-QBO-CHROME-customers-edit","vertical":"column-wave"}
 * @matrix-built {"modules":["customers"],"cols":["qbo_chrome"],"leafRe":"^(detail\\.fmcsa_verify|customers\\.modal\\.fmcsaverification)$","task":"VERTICAL-QBO-CHROME-customers-fmcsa-verify","vertical":"column-wave"}
 * @matrix-built {"modules":["customers"],"cols":["qbo_chrome"],"leafRe":"^customers\\.modal\\.customer_drill$","task":"VERTICAL-QBO-CHROME-customers-drill","vertical":"column-wave"}
 *
 * Self-test: node scripts/verify-customers-qbo-chrome-leaves.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-customers-qbo-chrome-leaves";
const REQUIRED = "docs/specs/scoreboard/modules/customers.required.json";
const FEED = "docs/specs/scoreboard/wire-sprint-built.json";
const SELF = "scripts/verify-customers-qbo-chrome-leaves.mjs";
const EXACT_HEADER = '/** @matrix-built {"modules":["customers"],"cols":["connectivity"],"leaves":["md.customer_details","customers.modal.customer_drill","customers.modal.customer_edit","customers.modal.fmcsaverification"],"task":"CUST-F5922-MODAL-DETAIL-CONNECTIVITY-EXACT","vertical":"class-sweep"} */';
const EXACT_ROUTES = new Map([
  ["md.customer_details", "/customers?tab=customer_details"],
  ["customers.modal.customer_drill", "surface://components/customers/CustomerDrillModal.tsx"],
  ["customers.modal.customer_edit", "surface://components/customers/CustomerEditModal.tsx"],
  ["customers.modal.fmcsaverification", "surface://components/customers/FMCSAVerificationModal.tsx"],
]);

const CHECKS = [
  { name: "list.view_master_detail / list.create: Customers.tsx real Modal variant=drawer create + ActionButton", file: "apps/frontend/src/pages/Customers.tsx", pattern: /<Modal variant="drawer" open=\{createOpen\}[\s\S]*title="Create Customer"/ },
  { name: "list.create door: + Create Customer writes ?create=1 (same proven drawer as Topbar / deep-link)", file: "apps/frontend/src/pages/Customers.tsx", pattern: /const openCreate = \(\) => \{[\s\S]*next\.set\("create", "1"\)[\s\S]*data-testid="customers-create-open"[\s\S]*onClick=\{openCreate\}/ },
  { name: "list.create open is URL-only (CUSTOMER-CREATE-DEAD-CLICK — no dual useState first-click drop)", file: "apps/frontend/src/pages/Customers.tsx", pattern: /const createOpen = searchParams\.get\("create"\) === "1"/ },
  { name: "scenario.customer hop lands on the create drawer, not a second dead + Create click", file: "apps/frontend/src/pages/program/scenario-tracker/registry.ts", pattern: /key: "scenario.customer"[\s\S]{0,500}href: "\/customers\?create=1"/ },
  { name: "scenario.driver_onboarding hop lands on Create Driver drawer via ?create=1", file: "apps/frontend/src/pages/program/scenario-tracker/registry.ts", pattern: /key: "scenario.driver_onboarding"[\s\S]{0,500}href: "\/drivers\?create=1"/ },
  { name: "Drivers roster honors ?create=1 (Program hop + page + Create same drawer)", file: "apps/frontend/src/pages/Drivers.tsx", pattern: /searchParams\.get\("create"\) === "1"[\s\S]*data-testid="drivers-create-open"[\s\S]*onClick=\{openCreate\}/ },
  { name: "Drivers create open is URL-only (same CUSTOMER-CREATE-DEAD-CLICK class)", file: "apps/frontend/src/pages/Drivers.tsx", pattern: /const addOpen = searchParams\.get\("create"\) === "1"/ },
  { name: "Vendors + Create writes ?create=1 (same CUSTOMER-CREATE-DEAD-CLICK class)", file: "apps/frontend/src/pages/Vendors.tsx", pattern: /data-testid="vendors-create-open"[\s\S]*onClick=\{openCreate\}/ },
  { name: "Vendors create open is URL-only (VENDORS-CREATE-DEAD-CLICK)", file: "apps/frontend/src/pages/Vendors.tsx", pattern: /const createOpen = searchParams\.get\("create"\) === "1"/ },
  { name: "list.filters: CustomersListView real CollapsedListFilters + ParityTable", file: "apps/frontend/src/pages/customers/CustomersListView.tsx", pattern: /<ParityTable[\s\S]*CollapsedListFilters|CollapsedListFilters[\s\S]*<ParityTable/ },
  { name: "md.transaction_list: Customers.tsx ?tab=transaction_list real ParityTable", file: "apps/frontend/src/pages/Customers.tsx", pattern: /activeTab === "transaction_list"[\s\S]{0,2000}<ParityTable/ },
  { name: "md.customer_details: CustomerDetailsTab real DetailRow grid + EntityLinkOrTombstone + Edit action", file: "apps/frontend/src/pages/Customers.tsx", pattern: /function CustomerDetailsTab\(\{[\s\S]{0,800}data-testid="customer-details-edit"[\s\S]{0,3000}EntityLinkOrTombstone/ },
  { name: "md.new_transaction: Customers.tsx navigates to the real invoices list, customer-scoped", file: "apps/frontend/src/pages/Customers.tsx", pattern: /navigate\(`\/accounting\/invoices\?customer_id=\$\{selectedCustomer\.id\}`\)/ },
  { name: "detail.profile / detail.billing: CustomerDetail real DatePicker + MoneyInput chrome", file: "apps/frontend/src/pages/CustomerDetail.tsx", pattern: /MoneyInput[\s\S]*DatePicker|DatePicker[\s\S]*MoneyInput/ },
  { name: "detail.contacts.create: CustomerDetail real Modal variant=drawer Create Contact", file: "apps/frontend/src/pages/CustomerDetail.tsx", pattern: /<Modal variant="drawer" open=\{contactModalOpen\}/ },
  { name: "detail.billing.record_payment: CustomerDetail real inline DatePicker + MoneyInput payment fields", file: "apps/frontend/src/pages/CustomerDetail.tsx", pattern: /DatePicker[\s\S]{0,80}value=\{payDate\}[\s\S]{0,400}MoneyInput[\s\S]{0,80}valueDollars=\{payAmount\}/ },
  { name: "detail.quality.create_event: CustomerDetail real Modal variant=drawer Create Quality Event", file: "apps/frontend/src/pages/CustomerDetail.tsx", pattern: /<Modal variant="drawer" open=\{qualityModalOpen\}/ },
  { name: "detail.lanes.create: CustomerDetail real Modal variant=drawer Create/Edit Lane with MoneyInput", file: "apps/frontend/src/pages/CustomerDetail.tsx", pattern: /<Modal variant="drawer" open=\{laneModalOpen\}[\s\S]{0,4000}MoneyInput/ },
  { name: "detail.edit / customers.modal.customer_edit: CustomerDetail mounts the real CustomerEditModal", file: "apps/frontend/src/pages/CustomerDetail.tsx", pattern: /<CustomerEditModal/ },
  { name: "detail.fmcsa_verify / customers.modal.fmcsaverification: CustomerDetail mounts the real FMCSAVerificationModal", file: "apps/frontend/src/pages/CustomerDetail.tsx", pattern: /<FMCSAVerificationModal/ },
  { name: "customers.modal.customer_drill: CustomerDrillModal is a real Modal", file: "apps/frontend/src/components/customers/CustomerDrillModal.tsx", pattern: /<Modal\b/ },
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
  const customersSrc = fs.readFileSync(path.join(root, "apps/frontend/src/pages/Customers.tsx"), "utf8");
  if (customersSrc.includes('useState(() => searchParams.get("create")')) {
    fails.push("Customers.tsx must not dual-store createOpen in useState (CUSTOMER-CREATE-DEAD-CLICK)");
  }
  const driversSrc = fs.readFileSync(path.join(root, "apps/frontend/src/pages/Drivers.tsx"), "utf8");
  if (driversSrc.includes('useState(() => searchParams.get("create")')) {
    fails.push("Drivers.tsx must not dual-store addOpen in useState (DRIVERS-CREATE-DEAD-CLICK)");
  }
  const vendorsSrc = fs.readFileSync(path.join(root, "apps/frontend/src/pages/Vendors.tsx"), "utf8");
  if (vendorsSrc.includes("const [createOpen, setCreateOpen] = useState(false)")) {
    fails.push("Vendors.tsx must not local-only createOpen (VENDORS-CREATE-URL-OPEN / silent ?create=1)");
  }
  return fails;
}

function runEvidence(requiredSrc, selfSrc, feedSrc) {
  const fails = [];
  const required = JSON.parse(requiredSrc);
  for (const [id, route] of EXACT_ROUTES) {
    const leaf = required.leaves?.find((row) => row.id === id);
    if (!leaf?.required?.includes("connectivity")) fails.push(`${REQUIRED}: ${id} must require connectivity`);
    if (leaf?.route_hint !== route) fails.push(`${REQUIRED}: ${id} must name route ${route}`);
  }
  if (!selfSrc.split("/**\n * Customers")[0].includes(EXACT_HEADER)) fails.push(`${SELF}: exact modal/detail connectivity header missing`);
  if (/"guard"\s*:\s*"scripts\/verify-customers-qbo-chrome-leaves\.mjs"/.test(feedSrc)) fails.push(`${FEED}: manual feed duplicates exact modal/detail connectivity`);
  return fails;
}

function selftest() {
  const live = runChecks();
  const requiredGood = fs.readFileSync(path.join(ROOT, REQUIRED), "utf8");
  const selfGood = fs.readFileSync(path.join(ROOT, SELF), "utf8");
  const feedGood = fs.readFileSync(path.join(ROOT, FEED), "utf8");
  const evidenceLive = runEvidence(requiredGood, selfGood, feedGood);
  const tmp = fs.mkdtempSync(path.join(ROOT, "scripts", ".customers-qbo-chrome-selftest-"));
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
  if (evidenceLive.length) {
    console.error(`${LABEL} SELFTEST FAIL evidence:\n- ${evidenceLive.join("\n- ")}`);
    process.exit(1);
  }
  let evidenceCaught = 0;
  for (const id of EXACT_ROUTES.keys()) {
    const mutated = requiredGood.replace(`"id": "${id}"`, `"id": "${id}.broken"`);
    if (mutated === requiredGood || runEvidence(mutated, selfGood, feedGood).length === 0) {
      console.error(`${LABEL} SELFTEST FAIL — Required mutation escaped: ${id}`);
      process.exit(1);
    }
    evidenceCaught++;
  }
  for (const [name, selfMutated, feedMutated] of [
    ["header", selfGood.replace(EXACT_HEADER, EXACT_HEADER.replace("connectivity", "reverse_link")), feedGood],
    ["feed", selfGood, feedGood.replace("[", `[{"guard":"scripts/verify-customers-qbo-chrome-leaves.mjs"},`)],
  ]) {
    if (runEvidence(requiredGood, selfMutated, feedMutated).length === 0) {
      console.error(`${LABEL} SELFTEST FAIL — ${name} evidence mutation escaped`);
      process.exit(1);
    }
    evidenceCaught++;
  }
  console.log(`${LABEL} SELFTEST PASS — ${evidenceCaught} exact connectivity evidence mutations detected`);
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();

const fails = runChecks();
fails.push(...runEvidence(
  fs.readFileSync(path.join(ROOT, REQUIRED), "utf8"),
  fs.readFileSync(path.join(ROOT, SELF), "utf8"),
  fs.readFileSync(path.join(ROOT, FEED), "utf8"),
));
if (fails.length) {
  console.error(`${LABEL} FAIL (${fails.length}):\n- ${fails.join("\n- ")}`);
  process.exit(1);
}
console.log(`${LABEL} PASS — ${CHECKS.length} customers qbo_chrome leaf asserts`);
