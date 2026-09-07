// CHAIN-03 STEP-1 — read-only DRAFT-JE preview endpoint (TRANSPORTATION ONLY).
//
//   POST /api/v1/accounting/bills/draft-je-preview
//
// Computes the journal entry a sample/real TRANSP bill WOULD post and returns it as a balanced
// DRAFT. WRITES NOTHING. Owner/Administrator only. Entity-locked to TRANSP (clone for TRK/USMCA
// later). The real post path (STEP-2) is gated by BILL_GL_POSTING_ENABLED (default OFF) and is NOT
// wired here — this endpoint never posts regardless of the flag.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentAuthUser, validationError, withCompanyScope } from "./shared.js";
import { EXPENSE_CATEGORY_MAP_KIND_VALUES } from "./expense-category-map/resolver.service.js";
import {
  BillGlDraftError,
  TRANSP_OPERATING_COMPANY_ID,
  computeBillGlDraft,
} from "./bill-gl-draft.service.js";
import { BillLineAccountError } from "./bill-account-resolver.js";
import { postSourceTransaction, PostingEngineError } from "./posting-engine.service.js";
import { isEnabled } from "../lib/feature-flags/service.js";
import { billOpenTourLoadId, TOUR_OPEN_HOLD_REASON } from "./tour-open-gate.service.js";

// CHAIN-03 posting gate (default OFF). Resolved PER-ENTITY via lib.feature_flags (isEnabled) inside the
// request handler — NOT a global process.env read — so a flag flip is per-operating_company_id and
// turning posting on for one entity (e.g. USMCA) cannot enable it for TRANSP/TRK. The draft-preview is
// read-only and never posts; the post-gl endpoint refuses to post unless the flag resolves true for the
// request's entity. Flipping it ON in prod is a separate Jorge sign-off.
const BILL_GL_POSTING_FLAG_KEY = "BILL_GL_POSTING_ENABLED";

const draftLineSchema = z.object({
  category_kind: z.enum(EXPENSE_CATEGORY_MAP_KIND_VALUES).nullish(),
  category_code: z.string().trim().max(120).nullish(),
  amount_cents: z.coerce.number().int().positive(),
  description: z.string().trim().max(500).nullish(),
});

const draftPreviewBodySchema = z.object({
  operating_company_id: z.string().uuid(),
  bill_label: z.string().trim().max(200).nullish(),
  posting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  lines: z.array(draftLineSchema).min(1).max(200),
});

export async function registerBillGlDraftRoutes(app: FastifyInstance) {
  app.post("/api/v1/accounting/bills/draft-je-preview", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!["Owner", "Administrator"].includes(user.role)) {
      return reply.code(403).send({ error: "forbidden", message: "Owner/Administrator only" });
    }

    const parsed = draftPreviewBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const body = parsed.data;

    // SCOPE LOCK — TRANSPORTATION ONLY (Jorge: finish TRANSP, then clone for TRK + USMCA).
    if (body.operating_company_id !== TRANSP_OPERATING_COMPANY_ID) {
      return reply.code(400).send({
        error: "transp_only",
        message:
          "CHAIN-03 STEP-1 is TRANSPORTATION-only. TRK and USMCA are cloned in a later step.",
      });
    }

    try {
      const { draft, postingEnabled } = await withCompanyScope(user.uuid, body.operating_company_id, async (client) => {
        const draft = await computeBillGlDraft(client, body.operating_company_id, {
          bill_label: body.bill_label ?? null,
          posting_date: body.posting_date ?? null,
          lines: body.lines.map((l) => ({
            category_kind: l.category_kind ?? null,
            category_code: l.category_code ?? null,
            amount_cents: l.amount_cents,
            description: l.description ?? null,
          })),
        });
        const postingEnabled = await isEnabled(client, BILL_GL_POSTING_FLAG_KEY, {
          operating_company_id: body.operating_company_id,
          user_uuid: String(user.uuid),
        });
        return { draft, postingEnabled };
      });

      return {
        step: "CHAIN-03-STEP-1-draft-je",
        posting_enabled: postingEnabled,
        wrote_to_ledger: false,
        draft,
      };
    } catch (err) {
      // Deliberate, named fail-loud failures (assembler + the shared line resolver) → 422 with the code.
      if (err instanceof BillGlDraftError || err instanceof BillLineAccountError) {
        return reply.code(422).send({ error: "draft_unresolvable", code: err.code, message: err.message });
      }
      throw err;
    }
  });

  // CHAIN-03 STEP-2 — actually post the bill's JE. Gated by BILL_GL_POSTING_ENABLED (default OFF).
  // Uses the SAME canonical writer (postSourceTransaction → buildBillLines → resolveBillLineDebitAccount)
  // the draft preview proves, so what posts equals the preview. TRANSP only. Tier-1 financial.
  app.post("/api/v1/accounting/bills/:id/post-gl", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!["Owner", "Administrator"].includes(user.role)) {
      return reply.code(403).send({ error: "forbidden", message: "Owner/Administrator only" });
    }

    const params = z.object({ id: z.string().uuid() }).safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = z.object({ operating_company_id: z.string().uuid() }).safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);

    if (query.data.operating_company_id !== TRANSP_OPERATING_COMPANY_ID) {
      return reply.code(400).send({
        error: "transp_only",
        message: "CHAIN-03 is TRANSPORTATION-only. TRK and USMCA are cloned in a later step.",
      });
    }

    // ACC-50 (LAW §2) — same open-tour hold as the auto-post path (bill-gl.service.ts), checked
    // before the posting flag: this manual endpoint must not be a back door around the hold.
    const openTourLoadId = await withCompanyScope(user.uuid, query.data.operating_company_id, (client) =>
      billOpenTourLoadId(client, query.data.operating_company_id, params.data.id)
    );
    if (openTourLoadId) {
      await withCompanyScope(user.uuid, query.data.operating_company_id, (client) =>
        client.query(
          `UPDATE accounting.bills SET posting_hold_reason=$2, updated_at=now() WHERE id=$1::uuid AND operating_company_id=$3::uuid`,
          [params.data.id, TOUR_OPEN_HOLD_REASON, query.data.operating_company_id]
        )
      );
      return reply.code(409).send({ error: "bill_tour_open", posting_hold_reason: TOUR_OPEN_HOLD_REASON, load_id: openTourLoadId });
    }

    const postingEnabled = await withCompanyScope(user.uuid, query.data.operating_company_id, (client) =>
      isEnabled(client, BILL_GL_POSTING_FLAG_KEY, {
        operating_company_id: query.data.operating_company_id,
        user_uuid: String(user.uuid),
      })
    );
    if (!postingEnabled) {
      return reply.code(409).send({
        error: "posting_disabled",
        message:
          "Bill→GL posting is disabled for this entity (BILL_GL_POSTING_ENABLED per-entity override OFF). Use draft-je-preview, or enable the per-entity override on a Neon branch to verify.",
      });
    }

    try {
      const result = await postSourceTransaction(
        {
          operating_company_id: query.data.operating_company_id,
          source_transaction_type: "bill",
          source_transaction_id: params.data.id,
        },
        { userId: user.uuid }
      );
      return { step: "CHAIN-03-STEP-2-post", posting_enabled: true, result };
    } catch (err) {
      if (err instanceof PostingEngineError) {
        return reply.code(422).send({ error: "post_failed", code: err.code, message: err.message });
      }
      throw err;
    }
  });
}
