/**
 * MANUAL-DELIVERY-AUTH-01 (owner request 2026-09-07, verbatim): "sometimes we might send a delivery
 * confirmation to the factoring, even though we have not officially delivered. they permit. we have
 * permission from customer and factoring. when we need to invoice we report the load delivered and
 * send invoice and signed pod bol to factoring and they purchase the invoice, but the truck is still
 * not empty, it is either waiting to deliver or still in transit. i need to be able to manually do
 * this, when closing a load have an option to create invoice and still not be delivered."
 *
 * This is a deliberate, narrow exception to the owner-approved Option B evidence gate
 * (revrec-delivery-posting/poster.service.ts, 2026-08-01: "recognition is EVIDENCE-driven, never
 * status-driven... a fabricated timestamp under a revenue entry is far more dangerous than an
 * unrecognized load"). It does NOT fabricate stop data or flip mdata.loads.status -- the truck's real
 * operational status is untouched; only the FINANCIAL/billing side is authorized early, and only via
 * this explicit, reason-required, role-gated, fully audited record
 * (dispatch.manual_delivery_authorizations). A manually-authorized posting's JE memo is always tagged
 * distinctly (poster.service.ts) -- never silently indistinguishable from real delivery evidence.
 *
 * What this route does, in order, inside one transaction:
 *   1. Validates the reason (>= 20 chars) and that BOTH customer_authorized and factoring_authorized
 *      are explicitly true (the DB CHECK constraint enforces this too -- belt and suspenders).
 *   2. Inserts the authorization row (one active row per load -- re-authorizing an already-authorized
 *      load is a 409 conflict, not a silent duplicate).
 *   3. Finds the load's final active delivery stop (same "last drop wins" ordering
 *      finalActiveDeliveryDepartureAt uses) and its assigned driver, and inserts a
 *      dispatch.pod_documents row directly with status='approved', source='manual_office_authorization'
 *      -- reusing the SAME table factoring's has_approved_pod gate already reads, rather than teaching
 *      that gate a second concept. Requires the caller to have already uploaded the real signed
 *      POD/BOL to docs.files and pass its id -- this route does not accept a raw file upload itself.
 *   4. Calls the SAME postLoadRevenueLatch used by every other Event 1/Event 2 trigger
 *      (target_status='delivered_pending_docs') -- now able to earn because step 2's authorization row
 *      satisfies the alternate-evidence check added to poster.service.ts.
 *   5. Calls assembleFactoringPacket with manualDeliveryAuthorizationId set, so the factoring packet
 *      (and its invoice, if none exists yet) assembles even though mdata.loads.status has not reached
 *      a deliverable value -- the ONLY caller allowed to set that field.
 *
 * Role-gated stricter than a plain POD review (officeDispatchRoles includes Dispatcher; this does
 * not) -- this authorizes revenue recognition ahead of physical evidence, a real financial exception,
 * not an operational one. Owner/Administrator/Manager only. Revisit with the owner if a narrower or
 * wider set is wanted; not guessed beyond that.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { currentAuthUser, validationError, withCompanyScope } from "../accounting/shared.js";
import { postLoadRevenueLatch } from "../accounting/revrec-delivery-posting/poster.service.js";
import { assembleFactoringPacket } from "../factoring/packet-assemble.service.js";
import { companyBusinessDate } from "../lib/company-business-date.js";

type ScopedClient = {
  query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[] }>;
};

const loadParamsSchema = z.object({ loadId: z.string().uuid() });

const authorizeBodySchema = z.object({
  operating_company_id: z.string().uuid(),
  reason: z.string().trim().min(20, "reason must be at least 20 characters"),
  customer_authorized: z.literal(true),
  factoring_authorized: z.literal(true),
  /** docs.files id of the already-uploaded signed POD/BOL. Strongly recommended, not hard-required
   *  (a load may be authorized moments before the signed document is scanned in) -- but the load
   *  will NOT be visible to the factoring submission queue until an approved POD exists, so leaving
   *  this null just means step 3 below is skipped and can be completed later via the normal POD
   *  upload+review flow once the document is in hand. */
  pod_docs_attachment_id: z.string().uuid().optional(),
});

function manualDeliveryAuthRoles(role: string) {
  return ["Owner", "Administrator", "Manager"].includes(role);
}

export async function registerManualDeliveryAuthorizationRoutes(app: FastifyInstance) {
  app.post(
    "/api/v1/dispatch/loads/:loadId/manual-delivery-authorization",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const user = currentAuthUser(req, reply);
      if (!user) return;
      if (!manualDeliveryAuthRoles(user.role)) return reply.code(403).send({ error: "forbidden" });

      const params = loadParamsSchema.safeParse(req.params ?? {});
      const body = authorizeBodySchema.safeParse(req.body ?? {});
      if (!params.success) return reply.code(400).send({ error: "validation_error" });
      if (!body.success) return validationError(reply, body.error);

      const result = await withCompanyScope(user.uuid, body.data.operating_company_id, async (client: ScopedClient) => {
        const loadRes = await client.query<{
          id: string;
          display_id: string | null;
          load_number: string;
          assigned_primary_driver_id: string | null;
        }>(
          `
            SELECT id::text, display_id, load_number, assigned_primary_driver_id::text
            FROM mdata.loads
            WHERE id = $1::uuid
              AND operating_company_id = $2::uuid
              AND soft_deleted_at IS NULL
            LIMIT 1
            FOR UPDATE
          `,
          [params.data.loadId, body.data.operating_company_id]
        );
        const load = loadRes.rows[0];
        if (!load) return { error: "load_not_found" as const };
        if (!load.assigned_primary_driver_id) return { error: "load_has_no_assigned_driver" as const };

        const existingRes = await client.query<{ id: string }>(
          `
            SELECT id::text
            FROM dispatch.manual_delivery_authorizations
            WHERE load_id = $1::uuid
              AND operating_company_id = $2::uuid
              AND revoked_at IS NULL
            LIMIT 1
          `,
          [load.id, body.data.operating_company_id]
        );
        if (existingRes.rows[0]) {
          return { error: "already_authorized" as const, authorization_id: existingRes.rows[0].id };
        }

        // Final active delivery stop, same ordering finalActiveDeliveryDepartureAt uses -- the stop
        // row exists from booking regardless of whether the driver has arrived/departed yet.
        const stopRes = await client.query<{ id: string }>(
          `
            SELECT id::text
            FROM mdata.load_stops
            WHERE load_id = $1::uuid
              AND stop_type::text = 'delivery'
              AND status::text <> 'cancelled'
              AND soft_deleted_at IS NULL
            ORDER BY sequence_number DESC
            LIMIT 1
          `,
          [load.id]
        );
        const stop = stopRes.rows[0];
        if (!stop) return { error: "load_has_no_delivery_stop" as const };

        const authRes = await client.query<{ id: string; authorized_at: string }>(
          `
            INSERT INTO dispatch.manual_delivery_authorizations (
              operating_company_id, load_id, reason, customer_authorized, factoring_authorized,
              pod_document_id, authorized_by_user_id
            )
            VALUES ($1::uuid, $2::uuid, $3, true, true, NULL, $4::uuid)
            RETURNING id::text, authorized_at::text
          `,
          [body.data.operating_company_id, load.id, body.data.reason, user.uuid]
        );
        const authorization = authRes.rows[0];
        if (!authorization) return { error: "authorization_write_failed" as const };

        let podDocumentId: string | null = null;
        if (body.data.pod_docs_attachment_id) {
          const podRes = await client.query<{ id: string }>(
            `
              INSERT INTO dispatch.pod_documents (
                operating_company_id, load_id, stop_id, driver_id, status, source,
                reviewed_by_user_id, reviewed_at, review_notes, docs_attachment_id
              )
              VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'approved', 'manual_office_authorization',
                      $5::uuid, now(), $6, $7::uuid)
              ON CONFLICT (operating_company_id, stop_id)
                WHERE archived_at IS NULL AND status <> 'rejected'
              DO NOTHING
              RETURNING id::text
            `,
            [
              body.data.operating_company_id,
              load.id,
              stop.id,
              load.assigned_primary_driver_id,
              user.uuid,
              `Manual delivery authorization: ${body.data.reason}`,
              body.data.pod_docs_attachment_id,
            ]
          );
          podDocumentId = podRes.rows[0]?.id ?? null;
          if (podDocumentId) {
            await client.query(
              `UPDATE dispatch.manual_delivery_authorizations SET pod_document_id = $2::uuid, updated_at = now() WHERE id = $1::uuid`,
              [authorization.id, podDocumentId]
            );
          }
        }

        await appendCrudAudit(
          client,
          user.uuid,
          "dispatch.load.manual_delivery_authorized",
          {
            resource_type: "mdata.loads",
            resource_id: load.id,
            operating_company_id: body.data.operating_company_id,
            authorization_id: authorization.id,
            pod_document_id: podDocumentId,
            reason: body.data.reason,
          },
          "warning",
          "MANUAL-DELIVERY-AUTH-01"
        );

        return {
          ok: true as const,
          load,
          authorization,
          podDocumentId,
        };
      });

      if ("error" in result) {
        if (result.error === "load_not_found") return reply.code(404).send({ error: result.error });
        if (result.error === "already_authorized") {
          return reply.code(409).send({ error: result.error, authorization_id: result.authorization_id });
        }
        return reply.code(422).send({ error: result.error });
      }

      // Event 1 earn -- outside the write transaction's row-lock scope is fine here: postLoadRevenueLatch
      // is idempotent (loadLatchExists) and takes its own client via withLuciaBypass.
      const entryDateIso = companyBusinessDate();
      const revrec = await postLoadRevenueLatch({
        operating_company_id: body.data.operating_company_id,
        load_id: result.load.id,
        target_status: "delivered_pending_docs",
        entry_date_iso: entryDateIso,
        actor_user_id: user.uuid,
      });

      let packet: Awaited<ReturnType<typeof assembleFactoringPacket>> | null = null;
      if (result.podDocumentId) {
        packet = await assembleFactoringPacket({
          loadId: result.load.id,
          operatingCompanyId: body.data.operating_company_id,
          userId: user.uuid,
          manualDeliveryAuthorizationId: result.authorization.id,
        });
      }

      return {
        authorization_id: result.authorization.id,
        authorized_at: result.authorization.authorized_at,
        pod_document_id: result.podDocumentId,
        revrec,
        factoring_packet: packet,
      };
    }
  );
}
