#!/usr/bin/env node
/**
 * ACCT-F5701 — a billable cancellation charge (TONU) used to be captured (dispatch.load_
 * cancellations.cancellation_charge_cents) and never billed — no path to an invoice/A/R/GL, so the
 * money silently evaporated. This guard locks the fix shape: cancelLoad must, when the cancellation
 * is genuinely billable and not pending owner approval, call the real TONU invoice writer behind a
 * per-entity flag gate, then persist the resulting forward link back onto the cancellation row.
 *
 * FAIL: any of the gate/call/link-persist pieces is missing, or the flag check is dropped (a
 * billable cancellation would then always bill, ignoring the per-entity kill switch).
 * PASS: all present.
 *
 * Self-test: node scripts/verify-tonu-cancellation-ar-linkage.mjs --selftest
 */
import fs from "node:fs";

const LABEL = "verify-tonu-cancellation-ar-linkage";
const SVC = "apps/backend/src/dispatch/cancellation.service.ts";
const INVOICE_WRITER = "apps/backend/src/dispatch/cancellation-tonu-invoice.ts";

function failures(sources) {
  const out = [];
  const svc = sources[SVC];
  const writer = sources[INVOICE_WRITER];

  if (!/createTonuInvoiceForCancellation/.test(svc)) {
    out.push(`${SVC}: cancelLoad must call createTonuInvoiceForCancellation — the billable-charge path is not wired`);
  }
  if (!/TONU_CANCELLATION_AR_POSTING_FLAG_KEY/.test(svc)) {
    out.push(`${SVC}: must gate the TONU billing call on TONU_CANCELLATION_AR_POSTING_FLAG_KEY (per-entity kill switch)`);
  }

  const gateStart = svc.indexOf("resolvedBillable && input.cancellation_charge_cents != null");
  if (gateStart === -1) {
    out.push(`${SVC}: the billable+charge-present precondition is missing or changed shape — re-check this guard`);
  } else {
    const scoped = svc.slice(gateStart, gateStart + 1600);
    if (!/isEnabled\(client, TONU_CANCELLATION_AR_POSTING_FLAG_KEY/.test(scoped)) {
      out.push(`${SVC}: the flag must actually be checked (isEnabled) before calling the invoice writer, not assumed on`);
    }
    if (!/createTonuInvoiceForCancellation\(client,/.test(scoped)) {
      out.push(`${SVC}: createTonuInvoiceForCancellation must be called inside the flag-gated branch`);
    }
    if (!/UPDATE dispatch\.load_cancellations/.test(scoped) || !/charge_invoice_id\s*=\s*\$2::uuid/.test(scoped)) {
      out.push(`${SVC}: must persist charge_invoice_id back onto dispatch.load_cancellations after billing — forward+reverse drill would break otherwise`);
    }
  }

  if (!/no new GL math/i.test(writer) && !/no new journal-entry math/i.test(svc)) {
    out.push(`${INVOICE_WRITER} / ${SVC}: must document the "no new GL math" invariant (reuse-the-poster discipline)`);
  }
  if (!/resolveInvoiceLineRevenueAccountId\(input\.operatingCompanyId,/.test(writer)) {
    out.push(`${INVOICE_WRITER}: must resolve the revenue account via the EXISTING resolver (resolveInvoiceLineRevenueAccountId), never a hardcoded account id`);
  }
  if (!/line_type:\s*"tonu"/.test(writer) && !/'tonu'/.test(writer)) {
    out.push(`${INVOICE_WRITER}: the invoice line must be tagged line_type='tonu'`);
  }
  // Idempotency — never double-bill on a retried cancellation.
  if (!/il\.line_type = 'tonu'/.test(writer) || !/voided_at IS NULL/.test(writer)) {
    out.push(`${INVOICE_WRITER}: must check for an already-existing non-void TONU invoice on this load before creating a new one (idempotency)`);
  }

  return out;
}

const live = { [SVC]: fs.readFileSync(SVC, "utf8"), [INVOICE_WRITER]: fs.readFileSync(INVOICE_WRITER, "utf8") };

if (process.argv.includes("--selftest") || process.argv.includes("--self-test")) {
  const mutations = [
    {
      name: "flag check removed (would always bill regardless of the kill switch)",
      file: SVC,
      mutate: (text) =>
        text.replace(
          "const tonuFlagOn = await isEnabled(client, TONU_CANCELLATION_AR_POSTING_FLAG_KEY, {\n          operating_company_id: input.operating_company_id,\n          user_uuid: userId,\n        });\n        if (tonuFlagOn) {",
          "if (true) {"
        ),
    },
    {
      name: "invoice writer call removed",
      file: SVC,
      mutate: (text) => text.replace(/const tonuInvoice = await createTonuInvoiceForCancellation\([\s\S]*?\);/, ""),
    },
    {
      name: "forward-link persist removed (invoice created but never linked back)",
      file: SVC,
      mutate: (text) =>
        text.replace(
          /const backlinkRes = await client\.query<\{ id: string \}>\(\s*`\s*\n\s*UPDATE dispatch\.load_cancellations[\s\S]*?\[cancellation\.id, tonuInvoice\.invoiceId, tonuInvoice\.invoiceLineId, userId, input\.operating_company_id\]\s*\);/,
          ""
        ),
    },
    {
      name: "revenue resolver bypassed with a hardcoded account",
      file: INVOICE_WRITER,
      mutate: (text) => text.replace("resolveInvoiceLineRevenueAccountId(input.operatingCompanyId, { line_type: \"tonu\" })", "{ account_id: '00000000-0000-0000-0000-000000000000', revenue_code: 'tonu' }"),
    },
    {
      name: "idempotency check removed (would double-bill on retry)",
      file: INVOICE_WRITER,
      mutate: (text) =>
        text.replace(
          /const existing = await client\.query[\s\S]*?if \(existing\.rows\[0\]\) \{[\s\S]*?\n  \}\n/,
          ""
        ),
    },
  ];
  const escaped = [];
  for (const { name, file, mutate } of mutations) {
    const mutated = mutate(live[file]);
    if (mutated === live[file]) {
      escaped.push(`${name}: mutation anchor missing`);
      continue;
    }
    const mutant = { ...live, [file]: mutated };
    if (failures(mutant).length === 0) escaped.push(`${name}: planted defect escaped`);
  }
  if (escaped.length) {
    console.error(`${LABEL} SELFTEST FAIL\n${escaped.join("\n")}`);
    process.exit(1);
  }
  console.log(`${LABEL} SELFTEST PASS — ${mutations.length}/${mutations.length} planted defects rejected`);
  process.exit(0);
}

const missing = failures(live);
if (missing.length) {
  console.error(`${LABEL} FAIL\n${missing.map((f) => ` - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(`${LABEL} PASS — billable cancellations (TONU) bill through the flag-gated existing-poster path, forward-linked, idempotent`);
