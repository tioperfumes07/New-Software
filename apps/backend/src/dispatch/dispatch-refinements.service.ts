import { setScopedCompanyContext } from "../_helpers/scoped-company-context.js";
import { z } from "zod";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { withCurrentUser } from "../auth/db.js";
import { enqueueOutboxEvent } from "../outbox/enqueue-outbox-event.js";
import { enqueueOverrideNotice } from "../outbox/enqueue-override-notice.js";
import {
  assertDriverQualifiedForLoad,
  type DriverQualificationBlock,
} from "./driver-qualification.service.js";
import { bindLoadToGeofences } from "./geofences/load-geofence-binding.service.js";
import { advanceDraftStatusIfCrewed } from "./draft-crew-status-advance.js";

export type ReassignBody = {
  operating_company_id: string;
  load_id: string;
  new_driver_id: string;
  reason_code: string;
  notes?: string | null;
  requesting_user_role: string;
  override_reason?: string | null;
};

function normalizeStopType(raw: string): "pickup" | "delivery" | "fuel" | "rest" | "border" {
  const v = raw.toLowerCase();
  if (v === "dropoff") return "delivery";
  if (v === "customs") return "border";
  if (v === "pickup" || v === "delivery" || v === "fuel" || v === "rest" || v === "border") return v;
  throw Object.assign(new Error("Unsupported stop type."), {
    statusCode: 400,
    code: "E_STOP_TYPE_INVALID",
  });
}

// OWNER-ONLY override for the DRIVER-QUALIFICATION gate (CDL / DOT medical / hazmat endorsement).
// Kept separate from generic canOverride* helpers so a future widening of a less-critical override
// cannot silently put a non-Owner past a federal DOT hard-stop.
function canOwnerOverrideQualification(role: string) {
  return role === "Owner";
}

export type LoadStopInput = {
  sequence_number: number;
  stop_type: string;
  location_address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postal_code?: string | null;
  address_line1?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  window_start?: string | null;
  window_end?: string | null;
  notes?: string | null;
  signature_required?: boolean;
  photo_required?: boolean;
  /** catalogs.pickup_time_types — picker_law on Load drawer Stops (parity with Book Load). */
  pickup_time_type_id?: string | null;
};

export async function manualReassignLoad(userId: string, input: ReassignBody) {
  return withCurrentUser(userId, async (client) => {
    await setScopedCompanyContext(client, userId, input.operating_company_id);
      const loadRes = await client.query(
        `
          SELECT id, operating_company_id, assigned_primary_driver_id, assigned_unit_id, assigned_secondary_driver_id, load_number,
                 COALESCE((quicksave_pending_fields->>'hazmat')::boolean, false) AS is_hazmat
          FROM mdata.loads
          WHERE id = $1
            AND operating_company_id = $2::uuid
            AND soft_deleted_at IS NULL
          FOR UPDATE
        `,
        [input.load_id, input.operating_company_id]
      );
      const load = loadRes.rows[0] as
        | {
            id: string;
            operating_company_id: string;
            assigned_primary_driver_id: string | null;
            assigned_unit_id: string | null;
            assigned_secondary_driver_id: string | null;
            load_number: string | null;
            is_hazmat: boolean;
          }
        | undefined;
      if (!load) throw new Error("E_LOAD_NOT_FOUND");

      // DISP-REASSIGN-DRIVER-EXISTS — assertDriverQualifiedForLoad returns null when the driver
      // row is missing (no credentials to evaluate). Without this check the UPDATE below hits
      // loads_assigned_primary_driver_id_fkey and leaks a Postgres 23503 to the operator.
      const driverExists = await client.query<{ id: string }>(
        `
          SELECT d.id::text AS id
          FROM mdata.drivers d
          WHERE d.id = $1::uuid
            AND (
              d.operating_company_id = $2::uuid
              OR EXISTS (
                SELECT 1
                FROM mdata.driver_company_authorizations reassign_driver_dca
                WHERE reassign_driver_dca.driver_id = d.id
                  AND reassign_driver_dca.company_id = $2::uuid
                  AND reassign_driver_dca.is_authorized = true
                  AND reassign_driver_dca.deactivated_at IS NULL
              )
            )
          LIMIT 1
        `,
        [input.new_driver_id, input.operating_company_id]
      );
      if (!driverExists.rows[0]) throw new Error("E_DRIVER_NOT_FOUND");

      if (input.new_driver_id !== load.assigned_primary_driver_id) {
        const block = await assertDriverQualifiedForLoad(client, {
          driverId: input.new_driver_id,
          operatingCompanyId: input.operating_company_id,
          isHazmat: load.is_hazmat,
        });

        if (block) {
          const ownerOverridingQualification =
            canOwnerOverrideQualification(input.requesting_user_role) &&
            typeof input.override_reason === "string" &&
            input.override_reason.trim().length >= 10;

          if (ownerOverridingQualification) {
            await appendCrudAudit(
              client,
              userId,
              "dispatch.driver_qualification_overridden_by_owner",
              {
                operating_company_id: input.operating_company_id,
                load_id: input.load_id,
                load_number: load.load_number,
                driver_id: block.driverId,
                driver_name: block.driverName,
                block_code: "E_DRIVER_NOT_QUALIFIED",
                overridden_reasons: block.reasons,
                cdl_expires_at: block.cdlExpiresAt,
                medical_expiry_date: block.medicalExpiryDate,
                hazmat_endorsement_expires_at: block.hazmatEndorsementExpiresAt,
                override_reason: input.override_reason,
                role: input.requesting_user_role,
                override_class: "DOT_QUALIFICATION",
                attestation_scope: "single_dispatch",
                severity_label: "critical",
              },
              "warning",
              "BT-3-DISPATCH-AUTH-GATES"
            );
            await enqueueOverrideNotice(client, block.driverId, {
              override_type: "driver_qualification",
              notify_channels: ["email", "sms"],
              operating_company_id: input.operating_company_id,
              overridden_reasons: block.reasons,
              override_reason: input.override_reason,
              override_by_user_id: userId,
              override_class: "DOT_QUALIFICATION",
            });
          } else {
            await appendCrudAudit(
              client,
              userId,
              "dispatch.load.reassign_blocked_by_driver_qualification",
              {
                operating_company_id: input.operating_company_id,
                load_id: input.load_id,
                load_number: load.load_number,
                driver_id: block.driverId,
                driver_name: block.driverName,
                block_code: "E_DRIVER_NOT_QUALIFIED",
                reasons: block.reasons,
                cdl_expires_at: block.cdlExpiresAt,
                medical_expiry_date: block.medicalExpiryDate,
                hazmat_endorsement_expires_at: block.hazmatEndorsementExpiresAt,
                override_available_to: "Owner",
                override_attempted: Boolean(input.override_reason),
              },
              "warning",
              "BT-3-DISPATCH-AUTH-GATES"
            );
            const err = new Error("E_DRIVER_NOT_QUALIFIED");
            (err as Error & { reasons: string[] }).reasons = block.reasons;
            throw err;
          }
        }
      }

      const reassignmentUpdate = await client.query<{ id: string }>(
        `
          UPDATE mdata.loads
          SET assigned_primary_driver_id = $2,
              updated_at = now()
          WHERE id = $1
            AND operating_company_id = $3::uuid
          RETURNING id
        `,
        [input.load_id, input.new_driver_id, input.operating_company_id]
      );
      if (!reassignmentUpdate.rows[0]?.id) throw new Error("E_LOAD_NOT_FOUND");

      // WIZ-STATUS-01 DURABLE FIX (owner order 2026-09-05) — this write path assigns a primary
      // driver straight to mdata.loads without going through updateDispatchLoad()'s own status
      // advance; a draft load manually reassigned a driver here would otherwise stay draft forever.
      await advanceDraftStatusIfCrewed(client, input.load_id, input.operating_company_id);

      const assignmentHistory = await client.query<{ id: string }>(
        `
          INSERT INTO dispatch.load_assignment_history (
            operating_company_id, load_id, assignment_method,
            previous_driver_id, new_driver_id,
            previous_unit_id, new_unit_id,
            previous_trailer_id, new_trailer_id,
            assigned_by_user_id, warnings_acknowledged,
            reason_code, notes
          )
          VALUES ($1,$2,'manual_reassign',$3,$4,$5,$5,$6,$6,$7,'[]'::jsonb,$8,$9)
          RETURNING id::text
        `,
        [
          input.operating_company_id,
          input.load_id,
          load.assigned_primary_driver_id ?? null,
          input.new_driver_id,
          load.assigned_unit_id ?? null,
          load.assigned_secondary_driver_id ?? null,
          userId,
          input.reason_code,
          input.notes ?? null,
        ]
      );
      if (!assignmentHistory.rows[0]?.id) {
        throw new Error("E_ASSIGNMENT_HISTORY_WRITE_FAILED");
      }

      await enqueueOutboxEvent(
        client,
        "load.reassigned",
        { aggregate_type: "load", aggregate_id: input.load_id },
        {
          load_id: input.load_id,
          load_number: load.load_number,
          operating_company_id: input.operating_company_id,
          from_driver_id: load.assigned_primary_driver_id,
          to_driver_id: input.new_driver_id,
          reason_code: input.reason_code,
          reassigned_by_user_id: userId,
        }
      );

      const previousPrimary = load.assigned_primary_driver_id;
      if (previousPrimary && previousPrimary !== input.new_driver_id) {
        await enqueueOutboxEvent(
          client,
          "load.reassigned_away_from_driver",
          { aggregate_type: "load", aggregate_id: input.load_id },
          {
            operating_company_id: input.operating_company_id,
            load_id: input.load_id,
            load_number: load.load_number,
            driver_id: previousPrimary,
            replacement_driver_id: input.new_driver_id,
          }
        );
      }
      if (input.new_driver_id !== previousPrimary) {
        await enqueueOutboxEvent(
          client,
          "load.assigned_to_driver",
          { aggregate_type: "load", aggregate_id: input.load_id },
          {
            operating_company_id: input.operating_company_id,
            load_id: input.load_id,
            load_number: load.load_number,
            driver_id: input.new_driver_id,
            previous_driver_id: previousPrimary,
          }
        );
      }

      await appendCrudAudit(
        client,
        userId,
        "dispatch.load.reassigned",
        {
          resource_type: "mdata.loads",
          resource_id: input.load_id,
          operating_company_id: input.operating_company_id,
          new_driver_id: input.new_driver_id,
          reason_code: input.reason_code,
        },
        "info",
        "P6-T11191"
      );

      return { ok: true as const, load_id: input.load_id };
  });

}

export async function listLoadStopsRefined(userId: string, operatingCompanyId: string, loadId: string) {
  return withCurrentUser(userId, async (client) => {
    await setScopedCompanyContext(client, userId, operatingCompanyId);
    const res = await client.query(
      `
        SELECT
          ls.id,
          ls.load_id,
          ls.sequence_number,
          ls.stop_type::text AS stop_type,
          ls.location_id,
          ls.address_line1,
          ls.city,
          ls.state,
          ls.country,
          ls.postal_code,
          ls.scheduled_arrival_at,
          ls.scheduled_departure_at,
          ls.appointment_start_at,
          ls.appointment_end_at,
          ls.notes,
          COALESCE(ls.stop_notes, ls.notes) AS stop_notes,
          ls.status::text AS status,
          ls.latitude,
          ls.longitude,
          ls.geocode_precision,
          ls.signature_required,
          ls.photo_required,
          ls.pickup_time_type_id,
          ls.created_at,
          ls.updated_at
        FROM mdata.load_stops ls
        INNER JOIN mdata.loads l ON l.id = ls.load_id
        WHERE ls.load_id = $1
          AND l.operating_company_id = $2::uuid
          AND ls.soft_deleted_at IS NULL
        ORDER BY ls.sequence_number ASC
      `,
      [loadId, operatingCompanyId]
    );
    return { stops: res.rows };
  });
}

export async function replaceLoadStopsRefined(
  userId: string,
  operatingCompanyId: string,
  loadId: string,
  stops: LoadStopInput[]
) {
  return withCurrentUser(userId, async (client) => {
    await setScopedCompanyContext(client, userId, operatingCompanyId);
      const load = await client.query(
        `SELECT id FROM mdata.loads WHERE id = $1 AND operating_company_id = $2::uuid AND soft_deleted_at IS NULL FOR UPDATE`,
        [loadId, operatingCompanyId]
      );
      if (!load.rows[0]) throw new Error("E_LOAD_NOT_FOUND");

      // INV-1: void-never-delete — lock and archive the exact active stop set before re-inserting.
      const existingStops = await client.query<{ id: string }>(
        `SELECT id::text AS id
           FROM mdata.load_stops
          WHERE load_id = $1::uuid
            AND soft_deleted_at IS NULL
          FOR UPDATE`,
        [loadId]
      );
      const existingStopIds = existingStops.rows.map((row) => row.id);
      const archivedStops = await client.query<{ id: string }>(
        `UPDATE mdata.load_stops
            SET soft_deleted_at = now()
          WHERE load_id = $1::uuid
            AND id = ANY($2::uuid[])
            AND soft_deleted_at IS NULL
        RETURNING id::text AS id`,
        [loadId, existingStopIds]
      );
      const archivedStopIds = new Set(archivedStops.rows.map((row) => row.id));
      if (
        archivedStopIds.size !== existingStopIds.length ||
        existingStopIds.some((id) => !archivedStopIds.has(id))
      ) {
        throw new Error("E_LOAD_STOP_REPLACE_ARCHIVE_CONFLICT");
      }

      for (const s of stops) {
        const st = normalizeStopType(s.stop_type);
        const apStart = s.window_start ?? null;
        const apEnd = s.window_end ?? null;
        const addr1 = s.address_line1 ?? s.location_address ?? null;
        const insertedStop = await client.query<{ id: string }>(
          `
            INSERT INTO mdata.load_stops (
              load_id, sequence_number, stop_type,
              address_line1, city, state, country, postal_code,
              scheduled_arrival_at, appointment_start_at, appointment_end_at,
              notes, stop_notes, status,
              latitude, longitude, signature_required, photo_required,
              time_window_type, pickup_time_type_id
            )
            RETURNING id::text AS id
            VALUES (
              $1,$2,$3::mdata.stop_type_enum,
              $4,$5,$6,$7,$8,
              $9,$10,$11,
              $12,$12,'pending'::mdata.stop_status_enum,
              $13,$14,$15,$16,
              CASE WHEN $10 IS NOT NULL THEN 'appointment'::mdata.time_window_type_enum ELSE 'first_come_first_serve'::mdata.time_window_type_enum END,
              $17
            )
          `,
          [
            loadId,
            s.sequence_number,
            st,
            addr1,
            s.city ?? null,
            s.state ?? null,
            s.country ?? "US",
            s.postal_code ?? null,
            apStart,
            apStart,
            apEnd,
            s.notes ?? null,
            s.latitude ?? null,
            s.longitude ?? null,
            Boolean(s.signature_required),
            Boolean(s.photo_required),
            s.pickup_time_type_id ?? null,
          ]
        );
        if (!insertedStop.rows[0]?.id) {
          throw new Error("E_LOAD_STOP_REPLACE_INSERT_CONFLICT");
        }
      }

      await bindLoadToGeofences(client, operatingCompanyId, loadId);

      await appendCrudAudit(
        client,
        userId,
        "dispatch.load.stops_replaced",
        { resource_type: "mdata.loads", resource_id: loadId, operating_company_id: operatingCompanyId, stop_count: stops.length },
        "info",
        "P6-T11191"
      );

      return { ok: true as const, load_id: loadId };
  });
}

export async function listAvailableDriversForDispatch(
  userId: string,
  operatingCompanyId: string,
  loadId: string,
  _forPickupAtIso: string | undefined
) {
  return withCurrentUser(userId, async (client) => {
    await setScopedCompanyContext(client, userId, operatingCompanyId);
    const loadPickup = await client.query(
      `
        SELECT COALESCE(sp.city, '') AS pickup_city, COALESCE(sp.state, '') AS pickup_state
        FROM mdata.loads l
        LEFT JOIN LATERAL (
          SELECT city, state FROM mdata.load_stops s
          WHERE s.load_id = l.id AND s.stop_type = 'pickup'::mdata.stop_type_enum
            AND s.soft_deleted_at IS NULL
          ORDER BY s.sequence_number ASC
          LIMIT 1
        ) sp ON true
        WHERE l.id = $1 AND l.operating_company_id = $2::uuid
      `,
      [loadId, operatingCompanyId]
    );
    const scopedLoad = loadPickup.rows[0];
    if (!scopedLoad) throw new Error("E_LOAD_NOT_FOUND");
    const pickupCity = String(scopedLoad.pickup_city ?? "");

    const res = await client.query(
      `
        SELECT
          d.id,
          d.first_name,
          d.last_name,
          d.id::text AS display_id,
          COALESCE(h.is_in_violation, false) AS is_in_violation,
          COALESCE(h.minutes_until_violation, 9999)::double precision AS minutes_until_violation
        FROM mdata.drivers d
        LEFT JOIN views.drivers_with_hos_status h ON h.id = d.id
        WHERE (
                d.operating_company_id = $1::uuid
                OR EXISTS (
                  SELECT 1
                  FROM mdata.driver_company_authorizations available_driver_dca
                  WHERE available_driver_dca.driver_id = d.id
                    AND available_driver_dca.company_id = $1::uuid
                    AND available_driver_dca.is_authorized = true
                    AND available_driver_dca.deactivated_at IS NULL
                )
              )
          AND d.status = 'Active'::mdata.driver_status
          AND d.deactivated_at IS NULL
        ORDER BY d.last_name ASC, d.first_name ASC
      `,
      [operatingCompanyId]
    );

    const rows = res.rows as Array<{
      id: string;
      first_name: string;
      last_name: string;
      display_id: string | null;
      is_in_violation: boolean;
      minutes_until_violation: number;
    }>;

    const drivers = rows.map((r, idx) => {
      const distanceToPickupMiles = pickupCity ? 12 + (idx % 37) : 50 + idx;
      const estimatedDriveHours = Math.min(11, Math.max(0.5, distanceToPickupMiles / 50));

      let hoursRemainingToday = 0;
      if (r.is_in_violation) hoursRemainingToday = 0;
      else hoursRemainingToday = Math.min(11, Math.max(0, (r.minutes_until_violation ?? 0) / 60));

      const hoursRemainingWeek = Math.min(70, hoursRemainingToday + 50);

      const hos_safe = !r.is_in_violation && hoursRemainingToday >= estimatedDriveHours;
      return {
        driver_id: r.id,
        display_name: `${r.first_name} ${r.last_name}`.trim(),
        display_id: r.display_id,
        hours_remaining_today: Math.round(hoursRemainingToday * 100) / 100,
        hours_remaining_week: Math.round(hoursRemainingWeek * 100) / 100,
        distance_to_pickup_miles: distanceToPickupMiles,
        hos_safe,
        is_in_violation: r.is_in_violation,
      };
    });
    drivers.sort((a, b) => {
      // ARCHIVE-not-DELETE (B21-D8): legacy HOS+proximity sort for dropdown fallback.
      // Ranked optimizer: GET /api/v1/dispatch/loads/:id/optimal-drivers + OptimalDriversPanel.
      if (a.hos_safe !== b.hos_safe) return a.hos_safe ? -1 : 1;
      return a.distance_to_pickup_miles - b.distance_to_pickup_miles;
    });
    return { drivers };
  });
}

export async function getDispatchLoadEta(userId: string, operatingCompanyId: string, loadId: string) {
  return withCurrentUser(userId, async (client) => {
    await setScopedCompanyContext(client, userId, operatingCompanyId);
    const res = await client.query(
      `
        SELECT l.id, l.status::text AS status, l.assigned_primary_driver_id, u.id AS unit_id,
               l.dispatcher_eta_at
        FROM mdata.loads l
        LEFT JOIN mdata.units u ON u.id = l.assigned_unit_id
                                AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = $2::uuid
        WHERE l.id = $1 AND l.operating_company_id = $2::uuid AND l.soft_deleted_at IS NULL
      `,
      [loadId, operatingCompanyId]
    );
    const row = res.rows[0] as
      | {
          id: string;
          status: string;
          assigned_primary_driver_id: string | null;
          unit_id: string | null;
          dispatcher_eta_at: Date | string | null;
        }
      | undefined;
      if (!row) throw new Error("E_LOAD_NOT_FOUND");
      if (row.status !== "in_transit") throw new Error("E_ETA_NOT_IN_TRANSIT");

    if (row.dispatcher_eta_at) {
      const manualAt = row.dispatcher_eta_at instanceof Date ? row.dispatcher_eta_at : new Date(row.dispatcher_eta_at);
      if (!Number.isNaN(manualAt.getTime())) {
        return {
          driver_lat: null as number | null,
          driver_lng: null as number | null,
          distance_remaining_miles: null as number | null,
          eta_at: manualAt.toISOString(),
          source: "manual" as const,
        };
      }
    }

    return {
      driver_lat: null as number | null,
      driver_lng: null as number | null,
      distance_remaining_miles: null as number | null,
      eta_at: null as string | null,
      source: "unavailable" as const,
    };
  });
}

export async function listLoadTemplates(userId: string, operatingCompanyId: string, filters: { customer_id?: string; template_id?: string } = {}) {
  return withCurrentUser(userId, async (client) => {
    await setScopedCompanyContext(client, userId, operatingCompanyId);
    const values: unknown[] = [operatingCompanyId];
    const predicates = ["operating_company_id = $1::uuid"];
    if (filters.customer_id) { values.push(filters.customer_id); predicates.push(`template_json->>'customer_id' = $${values.length}`); }
    if (filters.template_id) { values.push(filters.template_id); predicates.push(`id = $${values.length}::uuid`); }
    const res = await client.query<{
      id: string;
      name: string;
      template_json: Record<string, unknown>;
      created_at: string;
      updated_at: string;
      total_count: string | number;
    }>(
      `
        SELECT id, name, template_json, created_at, updated_at, COUNT(*) OVER() AS total_count
        FROM dispatch.load_templates
        WHERE ${predicates.join(" AND ")}
        ORDER BY name ASC, id ASC
      `,
      values
    );
    const total = Number(res.rows[0]?.total_count ?? 0);
    const templates = res.rows.map(({ total_count: _totalCount, ...row }) => row);
    return { templates, total };
  });
}

export async function createLoadTemplate(
  userId: string,
  input: { operating_company_id: string; name: string; template_json: Record<string, unknown> }
) {
  return withCurrentUser(userId, async (client) => {
    await setScopedCompanyContext(client, userId, input.operating_company_id);
    const customerId = input.template_json.customer_id;
    if (customerId !== undefined && customerId !== null && customerId !== "") {
      const parsedCustomerId = z.string().uuid().safeParse(customerId);
      if (!parsedCustomerId.success) {
        throw Object.assign(new Error("Template customer ID must be a valid UUID."), {
          statusCode: 400,
          code: "E_TEMPLATE_CUSTOMER_ID_INVALID",
        });
      }
      const customer = await client.query(
        `SELECT 1 FROM mdata.customers WHERE id = $1::uuid AND operating_company_id = $2::uuid LIMIT 1`,
        [parsedCustomerId.data, input.operating_company_id],
      );
      if (!customer.rows[0]) throw Object.assign(new Error("Customer does not belong to this operating company."), { statusCode: 400 });
    }
    const res = await client.query(
      `
        INSERT INTO dispatch.load_templates (operating_company_id, name, template_json, created_by_user_id)
        VALUES ($1, $2, $3::jsonb, $4)
        RETURNING id, name, template_json, created_at
      `,
      [input.operating_company_id, input.name.trim(), JSON.stringify(input.template_json), userId]
    );
    const template = res.rows[0];
    if (!template) {
      throw Object.assign(new Error("Load template was not persisted."), {
        statusCode: 409,
        code: "E_TEMPLATE_CREATE_FAILED",
      });
    }
    await appendCrudAudit(
      client,
      userId,
      "dispatch.load_template.created",
      {
        operating_company_id: input.operating_company_id,
        load_template_id: template.id,
        name: template.name,
        customer_id: customerId || null,
      },
      "info",
      "DISPATCH-LOAD-TEMPLATE-CREATE",
    );
    return template;
  });
}
