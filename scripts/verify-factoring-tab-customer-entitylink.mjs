#!/usr/bin/env node
/** Ratchet: load factoring tab connects the canonical load, customer, and invoice in both directions. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-factoring-tab-customer-entitylink";
const FILE = path.join(ROOT, "apps/frontend/src/components/dispatch/tabs/FactoringTab.tsx");
const source = fs.readFileSync(FILE, "utf8");

// FACTORING-GUARDS (owner ROUND 10, deadline 06:30Z): the customer-drill check below was a literal,
// exact-whitespace substring match (`kind="customer"\n            id={load.customer_id}\n
// name={load.customer_name ?? null}`) — LDT-4 (bd00b7cac1) reformatted that same JSX onto ONE line
// without touching the real binding, and the guard went red on formatting alone. Both drill checks
// are now whitespace-tolerant regexes so a future reformat (the lead is actively restyling this
// file) can never trip this guard while the real load/customer/invoice binding is unchanged — the
// guard's job is the binding, not the line-wrap.
export function collectFailures(src = source) {
  const failures = [];
  const requireText = (token, message) => { if (!src.includes(token)) failures.push(message); };
  const requireMatch = (re, message) => { if (!re.test(src)) failures.push(message); };
  requireText("const load = loadQ.data", "tab must consume the canonical selected load result");
  requireText("listInvoices(operatingCompanyId, { source_load_id: loadId, limit: 1 })", "invoice reader must bind selected company and exact source load");
  requireText("invoicesQ.data?.invoices?.[0] ?? null", "linked invoice must consume the exact source-load result");
  requireText('data-testid="factoring-tab-customer-entitylink"', "customer reverse surface must remain mounted");
  requireMatch(/kind="customer"\s+id=\{load\.customer_id\}\s+name=\{load\.customer_name\s*\?\?\s*null\}/, "customer drill must bind the load customer id and human name");
  requireMatch(/kind="invoice"\s+id=\{linkedInvoice\.id\}\s+name=\{linkedInvoice\.display_id\}/, "invoice drill must bind the matched invoice id and display id");
  requireText('data-testid="load-factoring-invoice-link"', "invoice reverse surface must remain mounted");
  return failures;
}

function selftest() {
  const baseline = collectFailures();
  if (baseline.length) throw new Error(`clean baseline red: ${baseline.join("; ")}`);
  const mutations = [
    ["const load = loadQ.data", "const load = undefined"],
    ["listInvoices(operatingCompanyId, { source_load_id: loadId, limit: 1 })", "listInvoices(operatingCompanyId, {})"],
    ["invoicesQ.data?.invoices?.[0] ?? null", "invoicesQ.data?.invoices?.find(() => true) ?? null"],
    ['data-testid="factoring-tab-customer-entitylink"', 'data-testid="planted-customer-missing"'],
    ["id={load.customer_id}", "id={load.id}"],
    ["name={load.customer_name ?? null}", "name={null}"],
    ["id={linkedInvoice.id}", "id={load.id}"],
    ['data-testid="load-factoring-invoice-link"', 'data-testid="planted-invoice-missing"'],
  ];
  let rejected = 0;
  for (const [needle, replacement] of mutations) {
    if (!source.includes(needle)) throw new Error(`plant target missing: ${needle}`);
    if (collectFailures(source.split(needle).join(replacement)).length) rejected += 1;
  }
  if (rejected !== mutations.length) throw new Error(`rejected ${rejected}/${mutations.length} plants`);
  // Whitespace-reflow regression: collapsing the invoice drill's multi-line attrs onto one line (or
  // spreading the customer drill's one-line attrs across many) must NOT trip the guard — this is
  // the exact regression class this guard extension exists to prevent.
  const reflowedInvoice = source.replace(
    /kind="invoice"\s+id=\{linkedInvoice\.id\}\s+name=\{linkedInvoice\.display_id\}/,
    'kind="invoice" id={linkedInvoice.id} name={linkedInvoice.display_id}'
  );
  if (collectFailures(reflowedInvoice).length) {
    throw new Error("reflowing the invoice drill's attrs onto one line was wrongly rejected — the guard is still whitespace-brittle");
  }
  console.log(`[${LABEL}] --selftest PASS: rejected ${rejected}/${mutations.length} load/customer/invoice plants, accepted 1/1 harmless reflow, without editing runtime files`);
}

try {
  if (process.argv.includes("--selftest")) selftest();
  else {
    const failures = collectFailures();
    if (failures.length) throw new Error(failures.join("; "));
    console.log(`[${LABEL}] PASS: selected load reverse-connects its customer and matched invoice`);
  }
} catch (error) {
  console.error(`[${LABEL}] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
