// C6-MONEY-JE-EXEMPT: builds the invoice DOCUMENT (header+lines) from a load. The real revenue-
// recognition JE posts later, once, via revrec-delivery-posting/poster.service.ts's
// postLoadRevenueLatch (calls createJournalEntry), triggered by delivery evidence and invoice-
// linking, not by invoice creation itself — verified 2026-09-02, GO-23 C6.
import { resolveInvoiceDisplayId } from "./display-id.js";
import { resolveInvoiceLineRevenueAccountId } from "../invoices/invoice-line-revenue-resolution.service.js";
import { recomputeInvoiceTotals } from "./shared.js";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { createJournalEntryOnClient } from "./journal-entries.service.js";

type Queryable = {
  query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[] }>;
};

type BuildInvoiceInput = {
  userId: string;
  operatingCompanyId: string;
  loadId: string;
  /**
   * ND-INV-01 — when true, create status=proforma (non-posting projection). Default false keeps
   * existing from-load API creating draft (operator-initiated).
   */
  asProforma?: boolean;
  requestedDisplayId?: string | null;
};

type BuildInvoiceResult = {
  invoice: Record<string, unknown>;
  line: Record<string, unknown>;
  idempotent: boolean;
};

function toIsoDate(value: unknown) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function stopExtraDescription(input: {
  sequence_number: number | null;
  stop_type: string | null;
  rate_type: string | null;
  description: string | null;
}) {
  const stopLabel = input.sequence_number ? `Stop ${input.sequence_number}` : "Stop";
  const stopType = input.stop_type ? ` ${String(input.stop_type).toUpperCase()}` : "";
  const rateLabel = input.rate_type ? ` · ${String(input.rate_type).replace(/_/g, " ")}` : "";
  const detail = input.description ? ` · ${input.description}` : "";
  return `${stopLabel}${stopType}${rateLabel}${detail}`;
}

/** Non-void invoice already linked to this load (from-load idempotency + PATCH uniqueness). */
export async function findConflictingInvoiceForLoad(
  client: Queryable,
  operatingCompanyId: string,
  loadId: string,
  excludeInvoiceId?: string
): Promise<Record<string, unknown> | null> {
  const values: unknown[] = [operatingCompanyId, loadId];
  let excludeSql = "";
  if (excludeInvoiceId) {
    values.push(excludeInvoiceId);
    excludeSql = `AND i.id <> $${values.length}`;
  }
  const res = await client.query(
    `
      SELECT i.id
      FROM accounting.invoices i
      WHERE i.operating_company_id = $1::uuid
        AND i.source_load_id = $2
        AND i.voided_at IS NULL
        ${excludeSql}
      LIMIT 1
    `,
    values
  );
  return res.rows[0] ?? null;
}

export async function buildInvoiceFromLoad(client: Queryable, input: BuildInvoiceInput): Promise<BuildInvoiceResult> {
  const existingRes = await client.query(
    `
      SELECT i.*
      FROM accounting.invoices i
      WHERE i.operating_company_id = $1::uuid
        AND i.source_load_id = $2
        AND i.voided_at IS NULL
      ORDER BY i.created_at DESC
      LIMIT 1
    `,
    [input.operatingCompanyId, input.loadId]
  );
  const existing = existingRes.rows[0] ?? null;
  if (existing) {
    const lineRes = await client.query(
      `
        SELECT *
        FROM accounting.invoice_lines
        WHERE invoice_id = $1
        ORDER BY display_order ASC, created_at ASC
        LIMIT 1
      `,
      [existing.id]
    );
    return { invoice: existing, line: lineRes.rows[0] ?? {}, idempotent: true };
  }

  const loadRes = await client.query(
    `
      SELECT
        l.id,
        l.load_number,
        l.customer_id,
        l.is_sample_data,
        l.rate_total_cents,
        l.status,
        l.created_at,
        l.updated_at,
        COALESCE(c.payment_terms_id, c2.payment_terms_id) AS payment_terms_id,
        COALESCE(c.ar_email, c2.ar_email) AS ar_email,
        COALESCE(c.ar_phone, c2.ar_phone) AS ar_phone,
        pt.terms_name AS payment_terms_label,
        pt.days_until_due AS payment_terms_days,
        delivery_stop.at AS delivery_stop_at
      FROM mdata.loads l
      -- ACCT-F5788 — mdata.customers' customers_select RLS excludes a deactivated customer for a
      -- non-bypass reader, and a plain JOIN here threw a misleading load_not_found (the load DOES
      -- exist; only its customer's active/inactive status changed) -- blocking legitimate invoicing
      -- for a load whose customer was archived after booking. Same class as ACCT-F5611/5767/5768/
      -- 5784/5785/5786/5787: LEFT JOIN + the existing full-row resolver (mdata.get_customer_same_
      -- company, ACCT-F5787) via a LATERAL fallback gated on "c.id IS NULL", customers_select
      -- untouched.
      LEFT JOIN mdata.customers c ON c.id = l.customer_id AND c.operating_company_id = l.operating_company_id
      LEFT JOIN LATERAL (
        SELECT * FROM mdata.get_customer_same_company(l.customer_id, l.operating_company_id)
        WHERE c.id IS NULL
      ) c2 ON true
      LEFT JOIN catalogs.payment_terms pt ON pt.id = COALESCE(c.payment_terms_id, c2.payment_terms_id)
      -- CASH-FLOW-01 (owner order 2026-09-06, ROUND 14): "due = invoice_date (delivery/conversion
      -- date) + customer terms." The real event this document reports is the delivery, not the
      -- moment software happened to mint/convert it -- last delivery stop only (multi-drop must
      -- not multiply the invoice), actual arrival preferred over scheduled (real over planned).
      LEFT JOIN LATERAL (
        SELECT COALESCE(ls.actual_arrival_at, ls.scheduled_arrival_at) AS at
        FROM mdata.load_stops ls
        WHERE ls.load_id = l.id AND ls.stop_type = 'delivery'
        ORDER BY ls.sequence_number DESC
        LIMIT 1
      ) delivery_stop ON true
      WHERE l.id = $1
        AND l.operating_company_id = $2::uuid
      LIMIT 1
    `,
    [input.loadId, input.operatingCompanyId]
  );
  const load = loadRes.rows[0] ?? null;
  if (!load) throw Object.assign(new Error("load_not_found"), { code: "load_not_found" });

  // ACCT-F267 / LV-INVOICE-RATE-SNAPSHOT-NEVER-RESYNCS — refuse to mint an invoice for a load that has
  // no rate yet.
  //
  // The line below snapshots load.rate_total_cents ONCE, at creation, and nothing re-syncs it. On a
  // rate-late load that produced a permanently $0 invoice: L-20260808-0087 was invoiced as
  // INV-2026-00021 at $0.00, the rate was set to $3,210.00 afterwards, and the invoice stayed at zero
  // forever — it had to be voided and re-created by hand. Four from-load invoices exist at $0.00.
  //
  // FAIL FAST RATHER THAN RE-SYNC, deliberately: an invoice whose amount can change after issue is a
  // document the customer may already have seen. The correct behaviour is not to create it early and
  // mutate it later — it is not to create it until there is something to bill. The caller retries once
  // the rate exists and the invoice is right the first time.
  //
  // A ZERO-RATE LOAD IS NOT ALWAYS AN ERROR, which is why this refuses rather than throws loudly: a
  // power-only rescue leg legitimately carries no customer revenue (L-20260808-0090 — its $0 invoice
  // INV-2026-00022 had to be voided precisely because a bobtail rescue generates no receivable). For
  // those loads the correct number of invoices is zero, and this makes that the default.
  //
  // CC-2's #4989 guards the Load drawer — the USER action. This is the SERVICE, which every other
  // caller reaches; guarding one without the other leaves the door open.
  const rateCents = Number(load.rate_total_cents ?? 0);
  if (!Number.isFinite(rateCents) || rateCents <= 0) {
    throw Object.assign(new Error("load_has_no_rate"), {
      code: "load_has_no_rate",
      load_id: String(load.id),
      rate_total_cents: rateCents,
    });
  }

  // INVOICE-DISPLAY-ID-EQUALS-LOAD-NUMBER (owner 2026-08-24): going-forward from-load mint
  // stores mdata.loads.load_number as accounting.invoices.display_id. Same number
  // proforma → sent → paid. Send must never remint (invoice-send.service.ts). Historical
  // INV-YYYY-NNNN rows stay. Manual/recurring/TONU still use the INV-YYYY-NNNN allocator.
  const loadNumber = String(load.load_number ?? "").trim();
  if (!loadNumber) {
    throw Object.assign(new Error("load_number_required_for_invoice_line"), {
      code: "load_number_required_for_invoice_line",
    });
  }
  const displayId = await resolveInvoiceDisplayId(
    client,
    input.operatingCompanyId,
    new Date(),
    input.requestedDisplayId,
    loadNumber
  );
  // CASH-FLOW-01 (owner order 2026-09-06, ROUND 14): "due = invoice_date (delivery/conversion
  // date) + customer terms." issue_date/delivery_date previously stamped `new Date()` (whenever
  // the mint code happened to run, e.g. a historical load converted today reads today's date) --
  // measured live: 39 sent USMCA invoices all carried issue_date = their mint day (09-04/05/06)
  // instead of their real delivery (some as early as 2026-08-10), pushing every due_date to
  // 2026-10-05/06 regardless of when the load actually delivered. The real delivery-stop date
  // (joined above) is the correct basis; `new Date()` is now only the last-resort fallback for a
  // load with no delivery stop recorded at all (should not happen for anything reaching invoicing,
  // but never throw here over it -- degrade to the mint moment rather than fail the mint).
  const invoiceDate = toIsoDate(load.delivery_stop_at) ?? toIsoDate(load.updated_at) ?? toIsoDate(load.created_at) ?? toIsoDate(new Date())!;
  const issueDate = new Date(`${invoiceDate}T00:00:00.000Z`);
  const paymentTermsDays = Number(load.payment_terms_days ?? 30);
  const dueDate = new Date(issueDate);
  dueDate.setUTCDate(dueDate.getUTCDate() + paymentTermsDays);
  const initialStatus = input.asProforma ? "proforma" : "draft";

  let invoiceRes: { rows: Record<string, unknown>[] };
  try {
    invoiceRes = await client.query(
      `
        INSERT INTO accounting.invoices (
          operating_company_id,
          customer_id,
          display_id,
          status,
          source_load_id,
          issue_date,
          due_date,
          delivery_date,
          payment_terms_id,
          payment_terms_label,
          payment_terms_days,
          ar_email_snapshot,
          ar_phone_snapshot,
          invoice_type,
          created_by_user_id,
          updated_by_user_id,
          -- ACCT-F193: a sample load must produce a SAMPLE invoice. Derived from the load exactly as
          -- driver-finance/settlements-load-bookended.service.ts:158 already does for settlements
          -- (opts.isSampleData ?? load.is_sample_data ?? false) — one source of truth, not a new rule.
          is_sample_data
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'from_load',$14,$14,$15
        )
        RETURNING *
      `,
      [
        input.operatingCompanyId,
        load.customer_id,
        displayId,
        initialStatus,
        input.loadId,
        issueDate.toISOString().slice(0, 10),
        dueDate.toISOString().slice(0, 10),
        invoiceDate,
        load.payment_terms_id ?? null,
        load.payment_terms_label ?? null,
        paymentTermsDays,
        load.ar_email ?? null,
        load.ar_phone ?? null,
        input.userId,
        // ACCT-F193 — lockstep with the $15 placeholder and the is_sample_data column above.
        load.is_sample_data ?? false,
      ]
    );
  } catch (err) {
    // DSP-MONEY-F7175 (GO-0031, CC-1): the existing-invoice check above (a plain SELECT, no row
    // lock) and this INSERT are not atomic — two racing from-load calls on the same never-before-
    // invoiced load (double-click, timeout-retry, or the POD-approval auto-trigger racing a manual
    // click) can both pass the SELECT and both reach this INSERT. Migration 202613270100 added a
    // partial unique index (uq_invoices_source_load_active, WHERE voided_at IS NULL) matching the
    // findConflictingInvoiceForLoad predicate above — the LOSING racer now hits a real 23505 here
    // instead of silently minting a duplicate invoice. Recognize exactly that constraint and fall
    // back to the existing-invoice idempotent path; any other error still propagates unchanged.
    const pgErr = err as { code?: string; constraint?: string };
    if (pgErr?.code === "23505" && pgErr?.constraint === "uq_invoices_source_load_active") {
      return buildInvoiceFromLoad(client, input);
    }
    throw err;
  }
  const invoice = invoiceRes.rows[0];

  const lineTotal = Number(load.rate_total_cents ?? 0);
  const revenueResolution = await resolveInvoiceLineRevenueAccountId(input.operatingCompanyId, {
    line_type: "linehaul",
  });
  // LV-INV-UUID — customer-facing line text must carry load_number (L-…), never the load UUID.
  const linehaulDescription = `Linehaul · Load ${loadNumber}`;
  const lineRes = await client.query(
    `
      INSERT INTO accounting.invoice_lines (
        operating_company_id,
        invoice_id,
        source_load_id,
        line_type,
        revenue_code,
        account_id,
        description,
        quantity,
        unit_amount_cents,
        line_total_cents,
        display_order
      ) VALUES ($1,$2,$3,'linehaul',$4,$5,$6,1,$7,$7,0)
      RETURNING *
    `,
    [
      input.operatingCompanyId,
      invoice.id,
      input.loadId,
      revenueResolution.revenue_code,
      revenueResolution.account_id,
      linehaulDescription,
      lineTotal,
    ]
  );
  const line = lineRes.rows[0];

  const stopExtraRatesRes = await client
    .query<{
      uuid: string;
      rate_type: string | null;
      amount_cents: number | null;
      description: string | null;
      sequence_number: number | null;
      stop_type: string | null;
    }>(
      `
        SELECT
          ser.uuid,
          ser.rate_type,
          ser.amount_cents,
          ser.description,
          ls.sequence_number,
          ls.stop_type::text AS stop_type
        FROM dispatch.stop_extra_rates ser
        JOIN mdata.load_stops ls
          ON ls.id = ser.stop_uuid
        WHERE ser.operating_company_id = $1::uuid
          AND ser.load_uuid = $2
          AND ser.is_active = true
        ORDER BY ls.sequence_number ASC, ser.created_at ASC
      `,
      [input.operatingCompanyId, input.loadId]
    )
    // ACCT-F74 — was `.catch(() => ({ rows: [] }))`, a blanket swallow on the ACCESSORIAL query. Any
    // error — a phantom column, an RLS refusal, a type mismatch — produced an empty result, and the
    // invoice was then created WITHOUT its accessorial lines: a customer silently UNDER-BILLED for
    // detention, layover and lumper, with no error anywhere. That is the false-empty pattern doc 06 §1
    // names, sitting in the invoice-creation path.
    //
    // The swallow's only legitimate purpose was tolerating an environment where the table does not
    // exist. That is now tested EXPLICITLY (to_regclass) and every other failure propagates: refusing
    // to create the invoice is strictly better than issuing one that is quietly short.
    .catch((err: unknown) => {
      const missingRelation =
        typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
      if (missingRelation)
        return {
          rows: [] as Array<{
            uuid: string;
            rate_type: string | null;
            amount_cents: number | null;
            description: string | null;
            sequence_number: number | null;
            stop_type: string | null;
          }>,
        };
      throw err;
    });

  if (stopExtraRatesRes.rows.length > 0) {
    const accessorialResolution = await resolveInvoiceLineRevenueAccountId(input.operatingCompanyId, {
      line_type: "accessorial",
    });
    for (let idx = 0; idx < stopExtraRatesRes.rows.length; idx += 1) {
      const rate = stopExtraRatesRes.rows[idx];
      const cents = Math.max(0, Number(rate.amount_cents ?? 0));
      const invoiceLineRes = await client.query<{ id: string }>(
        `
          INSERT INTO accounting.invoice_lines (
            operating_company_id,
            invoice_id,
            source_load_id,
            line_type,
            revenue_code,
            account_id,
            description,
            quantity,
            unit_amount_cents,
            line_total_cents,
            display_order
          ) VALUES ($1,$2,$3,'accessorial',$4,$5,$6,1,$7,$7,$8)
          RETURNING id
        `,
        [
          input.operatingCompanyId,
          invoice.id,
          input.loadId,
          accessorialResolution.revenue_code,
          accessorialResolution.account_id,
          stopExtraDescription({
            sequence_number: Number(rate.sequence_number ?? 0) || null,
            stop_type: rate.stop_type,
            rate_type: rate.rate_type,
            description: rate.description,
          }),
          cents,
          idx + 1,
        ]
      );
      const invoiceLineId = String(invoiceLineRes.rows[0]?.id ?? "");
      if (invoiceLineId) {
        await client.query(
          `
            UPDATE dispatch.stop_extra_rates
            SET invoice_line_uuid = $1,
                updated_at = now()
            WHERE uuid = $2
          `,
          [invoiceLineId, rate.uuid]
        );
      }
    }
  }

  await recomputeInvoiceTotals(client, String(invoice.id));

  // SET-24 (owner order 2026-09-04): a broker advance received before this invoice existed sits on
  // accounting.broker_advances with applied_to_invoice_id NULL -- an honest "received but not yet
  // applied" state, not an error. The first invoice minted for this load claims every unapplied
  // row (there should be at most one live invoice per load per findConflictingInvoiceForLoad's own
  // uniqueness guarantee, so no double-claim risk across invoices). Additive only: this NEVER
  // touches rate_total_cents / the invoice face, only the separate broker_advance_applied_cents
  // tracking column -- the receivable amount the factor will eventually purchase is reduced by
  // this, the invoice's own face amount never is.
  const unappliedAdvances = await client.query<{
    id: string;
    amount_cents: string;
    customer_id: string;
    receipt_journal_entry_id: string | null;
    disbursed_journal_entry_id: string | null;
    disbursed_amount_cents: string | null;
  }>(
    `
      SELECT id, amount_cents::text, customer_id::text, receipt_journal_entry_id::text, disbursed_journal_entry_id::text, disbursed_amount_cents::text
      FROM accounting.broker_advances
      WHERE load_id = $1::uuid
        AND operating_company_id = $2::uuid
        AND applied_to_invoice_id IS NULL
        AND voided_at IS NULL
      FOR UPDATE
    `,
    [input.loadId, input.operatingCompanyId]
  );
  if (unappliedAdvances.rows.length > 0) {
    const totalUnappliedCents = unappliedAdvances.rows.reduce((sum, row) => sum + Number(row.amount_cents), 0);
    await client.query(
      `UPDATE accounting.invoices SET broker_advance_applied_cents = COALESCE(broker_advance_applied_cents, 0) + $2 WHERE id = $1`,
      [invoice.id, totalUnappliedCents]
    );
    await client.query(
      `UPDATE accounting.broker_advances SET applied_to_invoice_id = $1::uuid, applied_at = now(), updated_at = now() WHERE id = ANY($2::uuid[])`,
      [invoice.id, unappliedAdvances.rows.map((r) => r.id)]
    );

    // SET-24 TIMING correction (owner order 2026-09-04): every claimed row that actually posted a
    // JE while unapplied (item (1)'s receipt, item (2)'s disbursement, or both) credited 2250
    // Customer Deposits at the time -- there was no invoice yet to reduce. Reclassifying THAT SAME
    // liability into 1100 AR now that a real receivable exists is the SAME claim loop above, not a
    // second claim path. A row with neither JE (a driver_pay advance the broker paid straight to
    // the driver, never disbursed) has nothing to reclassify -- it never touched 2250.
    for (const row of unappliedAdvances.rows) {
      const reclassCents = (row.receipt_journal_entry_id ? Number(row.amount_cents) : 0) + (row.disbursed_journal_entry_id ? Number(row.disbursed_amount_cents ?? 0) : 0);
      if (reclassCents <= 0) continue;
      const [depositAccountRes, receivableAccountRes] = await Promise.all([
        client.query<{ id: string }>(`SELECT id FROM catalogs.accounts WHERE operating_company_id = $1::uuid AND account_number = '2250' LIMIT 1`, [input.operatingCompanyId]),
        client.query<{ id: string }>(`SELECT id FROM catalogs.accounts WHERE operating_company_id = $1::uuid AND account_number = '1100' LIMIT 1`, [input.operatingCompanyId]),
      ]);
      const depositAccountId = depositAccountRes.rows[0]?.id;
      const receivableAccountId = receivableAccountRes.rows[0]?.id;
      if (!depositAccountId || !receivableAccountId) continue; // pre-202613720001 environment -- reclass unavailable, never crash invoice minting over it
      const reclassJe = await createJournalEntryOnClient(
        client as never,
        {
          operating_company_id: input.operatingCompanyId,
          entry_date: new Date().toISOString().slice(0, 10),
          memo: `Broker advance reclassified from customer deposit to receivable -- invoice minted for load ${input.loadId}`,
          source: "manual",
          postings: [
            {
              account_id: depositAccountId,
              debit_or_credit: "debit",
              amount_cents: reclassCents,
              entity_uuid: row.customer_id,
              entity_type: "customer",
              description: "Customer deposit liability cleared -- invoice now exists",
            },
            {
              account_id: receivableAccountId,
              debit_or_credit: "credit",
              amount_cents: reclassCents,
              entity_uuid: row.customer_id,
              entity_type: "customer",
              description: "Receivable reduced by the previously-deposited broker advance",
            },
          ],
        },
        { userId: input.userId, role: "system" }
      );
      await client.query(`UPDATE accounting.broker_advances SET reclass_journal_entry_id = $2::uuid, updated_at = now() WHERE id = $1`, [row.id, reclassJe.id]);
    }
  }

  const refreshedInvoiceRes = await client.query(`SELECT * FROM accounting.invoices WHERE id = $1 AND operating_company_id = $2::uuid LIMIT 1`, [invoice.id, input.operatingCompanyId]);
  const refreshedInvoice = refreshedInvoiceRes.rows[0] ?? invoice;

  await appendCrudAudit(
    client,
    input.userId,
    "accounting.invoices.created_from_load",
    {
      resource_type: "accounting.invoices",
      resource_id: refreshedInvoice.id,
      operating_company_id: input.operatingCompanyId,
      source_load_id: input.loadId,
      display_id: refreshedInvoice.display_id,
    },
    "info",
    "P3-T11.20.2-INVOICE-FLOW"
  );

  return { invoice: refreshedInvoice, line, idempotent: false };
}
