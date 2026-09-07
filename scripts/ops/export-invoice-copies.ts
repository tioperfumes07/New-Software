#!/usr/bin/env tsx
/**
 * scripts/ops/export-invoice-copies.ts — INV-COPIES-01 (owner order, ROUND 13, 2026-09-06):
 * "SEND SUPPRESS AND A COPY OF EACH IN MY DOWNLOADS."
 *
 * Renders the real invoice PDF for every currently `sent` USMCA invoice into
 * ~/Downloads/USMCA-INVOICES-2026-09-06/<display_id>.pdf. NO NEW RENDERER: this script reuses the
 * EXACT existing invoice document — the same `GET /api/v1/accounting/invoices/:invoiceId.html`
 * route this repo already serves for on-screen "Print" (accounting/invoice-render.routes.ts, which
 * itself builds the document from enrichInvoice + renderInvoiceBody + wrapPdfDocument — none of
 * that is touched or duplicated here) — invoked in-process via Fastify's own app.inject(), same
 * mechanism as scripts/seed-settlements-cc-3.ts and every other ops script this session. The
 * returned HTML is handed to puppeteer.page.setContent() + page.pdf(), the SAME two-call pattern
 * apps/backend/src/driver-finance/settlement-pdf-renderer.service.ts already uses to turn an
 * html-rendered document into a real PDF buffer.
 *
 * NO E-MAIL LEAVES THE SYSTEM: this script calls ONLY the read-only GET .html render route. It
 * never imports, calls, or goes near accounting/invoice-send.service.ts (the route that would
 * actually mark an invoice "sent" / dispatch anything) or any send/issue endpoint. Verified
 * separately, live: invoice-send.service.ts's own imports include enqueueEmail from
 * email/queue.service.ts, which only INSERTs a row into an email queue table (a durable outbox) —
 * it does not open an SMTP/mail-transport connection itself; some other, separate worker would have
 * to dequeue and actually transmit. This script's own code path never reaches that file at all.
 *
 * Usage:
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/export-invoice-copies.ts
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import puppeteer from "puppeteer";
import pg from "pg";
import { createIntegrationApp } from "../../apps/backend/test-helpers/http-app.js";
import { registerAccountingInvoiceHtmlRoutes } from "../../apps/backend/src/accounting/invoice-render.routes.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd"; // identity.users tioperfumes07@gmail.com, role Owner
const OUT_DIR = path.join(os.homedir(), "Downloads", "USMCA-INVOICES-2026-09-06");

type InvoiceRow = { id: string; display_id: string | null };

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

  const client = await pool.connect();
  let invoices: InvoiceRow[];
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
    const res = await client.query<InvoiceRow>(
      `SELECT id::text, display_id
         FROM accounting.invoices
        WHERE operating_company_id = $1::uuid
          AND status = 'sent'
        ORDER BY display_id ASC`,
      [USMCA_COMPANY_ID]
    );
    // False-empty guard: a positive control before trusting this list.
    const control = await client.query(
      `SELECT count(*)::int AS n FROM accounting.invoices WHERE operating_company_id = $1::uuid`,
      [USMCA_COMPANY_ID]
    );
    await client.query("ROLLBACK");
    if (Number(control.rows[0]?.n ?? 0) === 0) {
      throw new Error("invoices_control=0 — this connection cannot see accounting.invoices (masked read, not a verdict)");
    }
    invoices = res.rows;
  } finally {
    client.release();
  }

  if (invoices.length === 0) {
    console.log("No sent invoices found — nothing to export.");
    await pool.end();
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => {
    await registerAccountingInvoiceHtmlRoutes(a);
  });
  const authHeader = {
    "x-test-auth": Buffer.from(
      JSON.stringify({ id: OWNER_USER_ID, role: "Owner", email: "tioperfumes07@gmail.com" }),
      "utf8"
    ).toString("base64url"),
  };

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  const written: { file: string; bytes: number }[] = [];
  let failed = 0;
  try {
    for (const inv of invoices) {
      const displayId = (inv.display_id ?? inv.id).replace(/[^A-Za-z0-9._-]/g, "_");
      const htmlRes = await app.inject({
        method: "GET",
        url: `/api/v1/accounting/invoices/${inv.id}.html?operating_company_id=${USMCA_COMPANY_ID}`,
        headers: authHeader,
      });
      if (htmlRes.statusCode >= 300) {
        failed += 1;
        console.error(`BLOCKED invoice ${displayId} (${inv.id}) — ${htmlRes.statusCode} ${htmlRes.body}`);
        continue;
      }
      const page = await browser.newPage();
      try {
        await page.setContent(htmlRes.body, { waitUntil: "load" });
        const pdf = await page.pdf({ format: "Letter", printBackground: true });
        const pdfBuffer = Buffer.from(pdf);
        const filePath = path.join(OUT_DIR, `${displayId}.pdf`);
        fs.writeFileSync(filePath, pdfBuffer);
        written.push({ file: filePath, bytes: pdfBuffer.length });
        console.log(`DONE ${displayId}.pdf — ${pdfBuffer.length} bytes`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await app.close();
    await pool.end();
  }

  const totalBytes = written.reduce((sum, w) => sum + w.bytes, 0);
  const scriptSha256 = crypto.createHash("sha256").update(fs.readFileSync(new URL(import.meta.url))).digest("hex");
  console.log(
    `\nEXPORT totals: ${written.length} file(s) written, ${failed} failed, ${totalBytes} total bytes, ` +
      `output dir ${OUT_DIR}`
  );
  console.log(`Sample file names: ${written.slice(0, 3).map((w) => path.basename(w.file)).join(", ")}`);
  console.log(`Script sha256: ${scriptSha256}`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
