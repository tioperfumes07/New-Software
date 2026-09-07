/**
 * C6-MONEY-JE-EXEMPT: the accounting.invoices row created here is the same LOAD invoice document
 * from-load.ts builds (backfill when none exists yet) — the real revenue-recognition JE posts once
 * via revrec-delivery-posting/poster.service.ts's postLoadRevenueLatch (calls createJournalEntry),
 * triggered by the SAME delivery/POD-approval evidence this file's own trigger points already fire
 * on, not by this invoice creation — verified 2026-09-02, GO-23 C6.
 *
 * packet-assemble.service.ts — Auto-assemble factoring packet on delivery + POD approval.
 *
 * ACCT-F5630 — this header used to CLAIM a live trigger ("wired by callers, e.g. pod.routes.ts on POD
 * approval") that did not exist: assembleFactoringPacket and sweepAndAssemblePackets both had ZERO
 * call sites anywhere in the backend. Confirmed live: pod.routes.ts's POST .../pod-documents/:id/review
 * route never called this file at all. Fixed by wiring assembleFactoringPacket into that exact route
 * (fire-and-forget on approval) and sweepAndAssemblePackets into a new daily cron
 * (initializeFactoringPacketSweepCron, below) as the periodic-backfill trigger. The header below is now
 * accurate, not aspirational.
 *
 * Trigger points (both live):
 *   - POST /api/v1/dispatch/pod-documents/:id/review approves a POD (pod.routes.ts, fire-and-forget)
 *   - Daily 06:30 America/Chicago sweep cron (initializeFactoringPacketSweepCron) catches any load
 *     whose live trigger failed transiently or whose POD was approved before this wiring shipped
 *
 * What it does:
 *   1. Validates load is in a deliverable state and has an approved POD
 *   2. Stamps IH35_FACTORING_PACKAGE_V1::{generated_at} into load.notes
 *   3. Emits dispatch.factoring_packet_assembled outbox event
 *   4. Auto-creates invoice from load if none exists yet (idempotent via existing createInvoiceFromLoad route)
 *
 * What it NEVER does:
 *   - Submits to FARO (dispatcher must approve first)
 *   - Creates journal entries or touches any posting code
 *   - Modifies factoring_status (that stays on invoice, controlled by accounting routes)
 */
import type { FastifyInstance } from "fastify";
import cron from "node-cron";
import { withCurrentUser, withLuciaBypass } from "../auth/db.js";
import { enqueueOutboxEvent } from "../outbox/enqueue-outbox-event.js";
import { assertTenantContext } from "../cron/_helpers/tenant-context-guard.js";
import { wrapBackgroundJobTick } from "../lib/background-jobs.js";
import {
  FACTORING_PATH_LOAD_MDATA_STATUSES,
  isFactoringPathLoadStatus,
} from "../dispatch/delivery-evidence-status.js";

// Mirrors the established SYSTEM_ACTOR_USER_ID convention used by every other unattended cron in this
// backend (depreciation-autopost.cron.ts, factoring-posting/default-interest.service.ts, etc.).
const SYSTEM_ACTOR_ID = process.env.SYSTEM_ACTOR_USER_ID ?? "00000000-0000-4000-8000-000000000001";

const PACKET_PREFIX = "IH35_FACTORING_PACKAGE_V1::";

type PacketMeta = {
  generated_at: string | null;
  approved_at: string | null;
  emailed_at: string | null;
  uploaded_at: string | null;
  invoice_id: string | null;
};

function parsePacketMeta(notes: string | null | undefined): {
  meta: PacketMeta;
  visibleNotes: string;
} {
  const raw = String(notes ?? "");
  const empty: PacketMeta = {
    generated_at: null,
    approved_at: null,
    emailed_at: null,
    uploaded_at: null,
    invoice_id: null,
  };
  if (!raw.startsWith(PACKET_PREFIX)) return { meta: empty, visibleNotes: raw };
  const nl = raw.indexOf("\n");
  const chunk = nl >= 0 ? raw.slice(PACKET_PREFIX.length, nl) : raw.slice(PACKET_PREFIX.length);
  const rest = nl >= 0 ? raw.slice(nl + 1) : "";
  try {
    const parsed = JSON.parse(chunk) as Partial<PacketMeta>;
    return {
      meta: {
        generated_at: parsed.generated_at ?? null,
        approved_at: parsed.approved_at ?? null,
        emailed_at: parsed.emailed_at ?? null,
        uploaded_at: parsed.uploaded_at ?? null,
        invoice_id: parsed.invoice_id ?? null,
      },
      visibleNotes: rest,
    };
  } catch {
    return { meta: empty, visibleNotes: raw };
  }
}

function buildPacketNotes(meta: PacketMeta, visibleNotes: string): string {
  return `${PACKET_PREFIX}${JSON.stringify(meta)}\n${visibleNotes.trim()}`.trim();
}

export type AssemblePacketInput = {
  loadId: string;
  operatingCompanyId: string;
  userId: string;
  /** When true, assembles even if POD is not yet approved (used for manual trigger). */
  force?: boolean;
  /**
   * MANUAL-DELIVERY-AUTH-01 (owner request 2026-09-07) -- set ONLY by the manual delivery
   * authorization route (manual-delivery-authorization.routes.ts) after it has verified an active
   * dispatch.manual_delivery_authorizations row exists for this load. Skips the
   * isFactoringPathLoadStatus gate below for that one, explicitly-authorized call -- never set by the
   * POD-approval trigger or the daily sweep cron, which must keep requiring a real deliverable
   * mdata.loads.status. This is why it takes the authorization id rather than a bare boolean: a
   * caller cannot flip this on without actually holding one.
   */
  manualDeliveryAuthorizationId?: string;
};

export type AssemblePacketResult =
  | { ok: true; already_assembled: boolean; invoice_id: string | null }
  | { ok: false; reason: string };

/**
 * Assemble the FARO factoring packet for a delivered load.
 * Idempotent — safe to call multiple times (skips if already assembled).
 */
export async function assembleFactoringPacket(
  input: AssemblePacketInput,
): Promise<AssemblePacketResult> {
  return withCurrentUser(input.userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [
      input.operatingCompanyId,
    ]);

    // ── 1. fetch load ──────────────────────────────────────────────────────
    const loadRes = await client.query<{
      id: string;
      load_number: string;
      status: string;
      notes: string | null;
      customer_id: string;
    }>(
      `
      SELECT id, load_number, status, notes, customer_id
      FROM mdata.loads
      WHERE id = $1::uuid
        AND operating_company_id = $2::uuid
        AND soft_deleted_at IS NULL
      LIMIT 1
      `,
      [input.loadId, input.operatingCompanyId],
    );

    const load = loadRes.rows[0];
    if (!load) return { ok: false, reason: "load_not_found" };

    if (!isFactoringPathLoadStatus(load.status) && !input.manualDeliveryAuthorizationId) {
      return { ok: false, reason: `load_status_not_deliverable:${load.status}` };
    }

    // ── 2. check if already assembled ─────────────────────────────────────
    const { meta, visibleNotes } = parsePacketMeta(load.notes);
    if (meta.generated_at) {
      return { ok: true, already_assembled: true, invoice_id: meta.invoice_id };
    }

    // ── 3. verify approved POD (unless forced) ────────────────────────────
    if (!input.force) {
      const podRes = await client.query<{ id: string }>(
        `
        SELECT id FROM dispatch.pod_documents
        WHERE load_id = $1::uuid
          AND operating_company_id = $2::uuid
          AND status = 'approved'
          AND archived_at IS NULL
        LIMIT 1
        `,
        [input.loadId, input.operatingCompanyId],
      );
      if (podRes.rows.length === 0) {
        return { ok: false, reason: "no_approved_pod" };
      }
    }

    // ── 4. find or create invoice (idempotent) ─────────────────────────────
    const invRes = await client.query<{ id: string; display_id: string }>(
      `
      SELECT id, display_id
      FROM accounting.invoices
      WHERE source_load_id = $1::uuid
        AND operating_company_id = $2::uuid
        AND status != 'void'
      LIMIT 1
      `,
      [input.loadId, input.operatingCompanyId],
    );

    let invoiceId: string | null = invRes.rows[0]?.id ?? null;

    if (!invoiceId) {
      // Auto-create invoice from load — reuses existing invoice creation SQL path
      //
      // BANK-F9519-PACKET-ASSEMBLE-SILENT-INSERT-CATCH — this INSERT used to be wrapped in
      // `.catch(() => ({ rows: [] }))`. The ON CONFLICT DO NOTHING below already produces a
      // legitimate 0-rows outcome (invoice already exists — handled by the re-fetch), so a
      // .catch() had nothing honest left to catch: it could only swallow a REAL error (a bad
      // load id, a constraint violation, a DB hiccup) and misreport it as "conflict, re-fetch",
      // which then silently produced a null invoiceId with no trace of what actually failed. A
      // thrown error must propagate — the caller (the POD-approval route / the daily sweep cron)
      // already handles a rejected assembleFactoringPacket call.
      //
      // DSP-MONEY-F7175 (GO-0031, CC-1): two bugs found and fixed together, discovered via a
      // disposable-Neon-branch rehearsal of this exact INSERT (not a guess):
      // (1) `display_id` (NOT NULL, no column default, no trigger fills it) was missing from this
      //     INSERT entirely — this statement could never succeed inserting a new row, race or not.
      //     Added, sourced from `l.load_number` — the exact convention from-load.ts's own
      //     buildInvoiceFromLoad already uses (`const displayId = loadNumber`).
      // (2) `ON CONFLICT (source_load_id) DO NOTHING` had no matching arbiter — no unique/exclusion
      //     index existed on `source_load_id` at all, so this raised 42P10 the moment two racing
      //     calls (or any call once accounting.invoices had a pre-existing conflicting row) reached
      //     it. Migration 202613270100 adds a PARTIAL unique index matching
      //     findConflictingInvoiceForLoad's own predicate (`voided_at IS NULL`) — a load may
      //     accumulate multiple VOIDED invoices over time (void-not-delete), only one ACTIVE invoice
      //     per load is the real invariant. The ON CONFLICT clause's own inference predicate below
      //     must match the index predicate verbatim or Postgres still reports no matching arbiter.
      const newInvRes = await client.query<{ id: string }>(
        `
          INSERT INTO accounting.invoices (
            operating_company_id,
            customer_id,
            source_load_id,
            display_id,
            status,
            issue_date,
            due_date,
            invoice_type,
            created_by_user_id,
            -- ACCT-F353 — derive from the LOAD this invoice is generated from.
            is_sample_data
          )
          SELECT
            l.operating_company_id,
            l.customer_id,
            l.id,
            l.load_number,
            'draft',
            CURRENT_DATE,
            CURRENT_DATE + INTERVAL '30 days',
            'from_load',
            $3::uuid,
            COALESCE(l.is_sample_data, false)
          FROM mdata.loads l
          WHERE l.id = $1::uuid AND l.operating_company_id = $2::uuid
          ON CONFLICT (source_load_id) WHERE voided_at IS NULL AND source_load_id IS NOT NULL DO NOTHING
          RETURNING id
          `,
        [input.loadId, input.operatingCompanyId, input.userId],
      );

      if (newInvRes.rows[0]) {
        invoiceId = newInvRes.rows[0].id;
      } else {
        // conflict: re-fetch
        const refetch = await client.query<{ id: string }>(
          `SELECT id FROM accounting.invoices WHERE source_load_id = $1::uuid AND operating_company_id = $2::uuid AND status != 'void' LIMIT 1`,
          [input.loadId, input.operatingCompanyId],
        );
        invoiceId = refetch.rows[0]?.id ?? null;
      }
    }

    // ── 5. stamp packet metadata into load.notes ───────────────────────────
    const nextMeta: PacketMeta = {
      ...meta,
      generated_at: new Date().toISOString(),
      invoice_id: invoiceId,
    };

    await client.query(
      `UPDATE mdata.loads SET notes = $1, updated_at = now() WHERE id = $2::uuid AND operating_company_id = $3::uuid`,
      [buildPacketNotes(nextMeta, visibleNotes), input.loadId, input.operatingCompanyId],
    );

    // ── 6. emit outbox event ───────────────────────────────────────────────
    await enqueueOutboxEvent(
      client,
      "dispatch.factoring_packet_assembled",
      { aggregate_type: "mdata.loads", aggregate_id: input.loadId },
      {
        load_id: input.loadId,
        load_number: load.load_number,
        operating_company_id: input.operatingCompanyId,
        invoice_id: invoiceId,
        assembled_at: nextMeta.generated_at,
        assembled_by_user_id: input.userId,
        manual_delivery_authorization_id: input.manualDeliveryAuthorizationId ?? null,
      },
    ).catch(() => {
      // outbox emission stays best-effort: packet assembly must succeed regardless.
    });

    return { ok: true, already_assembled: false, invoice_id: invoiceId };
  });
}

/**
 * Batch-sweep: assemble packets for all delivered loads that:
 *   - have an approved POD
 *   - don't yet have a generated_at in notes
 *
 * Safe to run as a scheduled job or one-shot backfill.
 * Returns counts of assembled / skipped / errored.
 */
export async function sweepAndAssemblePackets(
  userId: string,
  operatingCompanyId: string,
): Promise<{ assembled: number; skipped: number; errored: number }> {
  return withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [
      operatingCompanyId,
    ]);

    const eligibleRes = await client.query<{ id: string; notes: string | null }>(
      `
      SELECT DISTINCT l.id, l.notes
      FROM mdata.loads l
      JOIN dispatch.pod_documents p
        ON p.load_id = l.id
        AND p.operating_company_id = l.operating_company_id
        AND p.status = 'approved'
        AND p.archived_at IS NULL
      WHERE l.operating_company_id = $1::uuid
        AND l.soft_deleted_at IS NULL
        AND l.status::text = ANY($2::text[])
      LIMIT 500
      `,
      [operatingCompanyId, FACTORING_PATH_LOAD_MDATA_STATUSES],
    );

    let assembled = 0;
    let skipped = 0;
    let errored = 0;

    for (const row of eligibleRes.rows) {
      const { meta } = parsePacketMeta(row.notes);
      if (meta.generated_at) {
        skipped++;
        continue;
      }
      // BANK-F9519-PACKET-ASSEMBLE-SILENT-INSERT-CATCH's fix removed the inner .catch() so a real
      // INSERT failure now propagates out of assembleFactoringPacket instead of being silently
      // swallowed. This loop processes up to 500 loads per company per run — one bad row's
      // exception must not abort the whole sweep and silently skip every remaining load, so this
      // is the sweep's own required try/catch (the fire-and-forget caller in pod.routes.ts already
      // has its own .catch(); this is the OTHER of the two call sites).
      try {
        const result = await assembleFactoringPacket({
          loadId: row.id,
          operatingCompanyId,
          userId,
          force: false,
        });
        if (result.ok) {
          assembled++;
        } else {
          errored++;
        }
      } catch (err) {
        errored++;
        console.error("[factoring-packet-sweep] assembleFactoringPacket failed", {
          load_id: row.id,
          operating_company_id: operatingCompanyId,
          err,
        });
      }
    }

    return { assembled, skipped, errored };
  });
}

/**
 * ACCT-F5630 — assembleFactoringPacket is now called at its intended live trigger (POD approval,
 * pod.routes.ts) as a fire-and-forget best-effort call. This cron is the SECOND intended trigger this
 * file's own header always claimed to have — a periodic sweep catching any load whose POD-approval
 * call failed transiently or whose POD was approved before this wiring shipped — and, like the live
 * trigger, it had zero call sites anywhere in the backend before this. Mirrors
 * initializeInsuranceLateFeeCron's own registration shape (ACCT-F5628): same company-list sweep, same
 * tenant-context assertion, same wrapBackgroundJobTick wrapper.
 */
let packetSweepCronInitialized = false;

export function initializeFactoringPacketSweepCron(app: FastifyInstance) {
  if (packetSweepCronInitialized) return;
  packetSweepCronInitialized = true;

  cron.schedule(
    "30 6 * * *",
    async () => {
      await wrapBackgroundJobTick(
        "factoring.packet_sweep_cron",
        async () => {
          await withLuciaBypass(async (client) => {
            const companies = await client.query<{ id: string }>(
              `
                SELECT id::text AS id
                FROM org.companies
                WHERE is_active = true
                  AND deactivated_at IS NULL
                ORDER BY id
              `
            );
            for (const company of companies.rows) {
              assertTenantContext(company.id, "factoring.packet_sweep_cron");
              await sweepAndAssemblePackets(SYSTEM_ACTOR_ID, company.id);
            }
          });
        },
        app.log
      );
    },
    {
      maxRandomDelay: 20000 /* cron-stagger (code only) — see PROD-OUTAGE-STEADY-STATE-CRON-PILEUP-CONFIRMED */, timezone: "America/Chicago" }
  );

  app.log.info("Factoring packet sweep cron scheduled (daily 06:30 America/Chicago)");
}
