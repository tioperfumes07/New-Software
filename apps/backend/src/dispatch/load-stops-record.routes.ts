import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/session-middleware.js";
import { withCurrentUser } from "../auth/db.js";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
import { computeDetentionBillableMinutes } from "./detention.lib.js";

// LDT-2 — Stops tab = read-only record of what happened on the load.
// One read model assembles: per-stop location + appointment + arrived/departed/
// dwell/detention/source/docs, the derived leg miles (practical/short/real/google
// ref), and the geofence arrival/departure events. There is no write path here —
// every field is edited in the Book Load wizard §C; this tab only reads.

const paramsSchema = z.object({ loadId: z.string().uuid() });
const querySchema = z.object({ operating_company_id: z.string().uuid() });

const DEFAULT_FREE_TIME_MINUTES = 120;

function authed(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user;
}

// Owner English: "Geofence + driver" (auto fence), "Driver only" (PWA), "Manual".
function sourceLabel(raw: string | null): "Geofence + driver" | "Driver only" | "Manual" {
  if (raw === "samsara_gps" || raw === "eld_geofence") return "Geofence + driver";
  if (raw === "driver_pwa" || raw === "driver_app") return "Driver only";
  return "Manual";
}

export type StopsRecordStop = {
  stop_id: string;
  sequence: number;
  stop_type: string;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  geocode_precision: string | null;
  geocode_missing: boolean;
  appointment_window_type: string | null;
  appointment_start_at: string | null;
  appointment_end_at: string | null;
  scheduled_arrival_at: string | null;
  arrived_at: string | null;
  departed_at: string | null;
  dwell_minutes: number | null;
  free_time_minutes: number;
  detention_minutes: number;
  detention_status: "accruing" | "closed" | "billed" | null;
  source: "Geofence + driver" | "Driver only" | "Manual";
  contact_name: string | null;
  contact_phone: string | null;
  gate_dock_text: string | null;
  signature_required: boolean;
  photo_required: boolean;
  lumper_required: boolean;
  lumper_amount_cents: number | null;
  doc_count: number;
};

export type StopsRecordLeg = {
  leg_index: number;
  leg_kind: string;
  from_label: string;
  to_label: string;
  // Practical/short come from the load (not stored per leg on this fleet yet);
  // real driven needs odometer (unavailable → null, never 0); google ref is per leg.
  practical_miles: number | null;
  short_miles: number | null;
  real_miles: number | null;
  google_reference_miles: number | null;
};

export type StopsRecordEvent = {
  occurred_at: string;
  event_kind: string;
  source: "Geofence + driver" | "Driver only" | "Manual";
  sequence: number | null;
  point_lat: number | null;
  point_lng: number | null;
};

export type StopsRecordResponse = {
  load: {
    miles_practical: number | null;
    miles_shortest: number | null;
    miles_deadhead: number | null;
  };
  stops: StopsRecordStop[];
  legs: StopsRecordLeg[];
  events: StopsRecordEvent[];
  geofence_event_count: number;
};

export async function registerLoadStopsRecordRoutes(app: FastifyInstance) {
  app.get(
    "/api/v1/dispatch/loads/:loadId/stops-record",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const user = authed(req, reply);
      if (!user) return;

      const params = paramsSchema.safeParse(req.params ?? {});
      const query = querySchema.safeParse(req.query ?? {});
      if (!params.success || !query.success) {
        return reply.code(400).send({ error: "validation_error" });
      }

      const { loadId } = params.data;
      const { operating_company_id } = query.data;

      await assertCompanyMembership(user.uuid, operating_company_id);

      const result = await withCurrentUser(user.uuid, async (client) => {
        await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operating_company_id]);

        const loadRes = await client.query<{
          id: string;
          miles_practical: string | null;
          miles_shortest: string | null;
          miles_deadhead: string | null;
        }>(
          `SELECT id, miles_practical::text, miles_shortest::text, miles_deadhead::text
           FROM mdata.loads
           WHERE id = $1 AND operating_company_id = $2::uuid AND soft_deleted_at IS NULL
           LIMIT 1`,
          [loadId, operating_company_id]
        );
        if (!loadRes.rows[0]) return null;
        const loadRow = loadRes.rows[0];

        const stopsRes = await client.query<{
          stop_id: string;
          sequence_number: number;
          stop_type: string;
          address_line1: string | null;
          city: string | null;
          state: string | null;
          postal_code: string | null;
          country: string | null;
          latitude: number | null;
          longitude: number | null;
          geocode_precision: string | null;
          time_window_type: string | null;
          appointment_start_at: string | null;
          appointment_end_at: string | null;
          scheduled_arrival_at: string | null;
          actual_arrival_at: string | null;
          actual_departure_at: string | null;
          actual_arrival_source: string | null;
          actual_departure_source: string | null;
          site_contact_name: string | null;
          site_contact_phone: string | null;
          gate_dock_text: string | null;
          signature_required: boolean;
          photo_required: boolean;
          lumper_required: boolean;
          lumper_amount_cents: number | null;
          doc_count: string;
        }>(
          `SELECT
             ls.id::text AS stop_id,
             ls.sequence_number,
             ls.stop_type::text,
             ls.address_line1,
             ls.city,
             ls.state,
             ls.postal_code,
             ls.country,
             ls.latitude,
             ls.longitude,
             ls.geocode_precision,
             ls.time_window_type,
             ls.appointment_start_at::text,
             ls.appointment_end_at::text,
             ls.scheduled_arrival_at::text,
             ls.actual_arrival_at::text,
             ls.actual_departure_at::text,
             ls.actual_arrival_source,
             ls.actual_departure_source,
             ls.site_contact_name,
             ls.site_contact_phone,
             ls.gate_dock_text,
             ls.signature_required,
             ls.photo_required,
             ls.lumper_required,
             ls.lumper_amount_cents,
             (SELECT count(*) FROM dispatch.pod_documents p
               WHERE p.stop_id = ls.id AND p.archived_at IS NULL)::text AS doc_count
           FROM mdata.load_stops ls
           WHERE ls.load_id = $1
             AND ls.soft_deleted_at IS NULL
           ORDER BY ls.sequence_number ASC`,
          [loadId]
        );

        const detentionRes = await client.query<{
          stop_id: string;
          detention_status: string;
          free_time_minutes: number;
          started_at: string;
          stopped_at: string | null;
        }>(
          `SELECT de.stop_id::text, de.status::text AS detention_status,
                  de.free_time_minutes, de.started_at::text, de.stopped_at::text
           FROM dispatch.detention_events de
           WHERE de.load_id = $1 AND de.operating_company_id = $2::uuid`,
          [loadId, operating_company_id]
        );
        const detentionByStop = new Map(detentionRes.rows.map((r) => [r.stop_id, r]));

        // Geofence entry/exit events for this load's auto-fences (label load-{id}-stop-{seq}).
        const geoRes = await client.query<{
          sequence_number: number;
          geo_entered_at: string | null;
          geo_exited_at: string | null;
          geo_source: string | null;
        }>(
          `SELECT
             CAST(SUBSTRING(g.label FROM '-stop-([0-9]+)$') AS integer) AS sequence_number,
             MIN(CASE WHEN ge.event_kind = 'entered' THEN ge.occurred_at::text END) AS geo_entered_at,
             MAX(CASE WHEN ge.event_kind = 'exited'  THEN ge.occurred_at::text END) AS geo_exited_at,
             MAX(ge.source::text) AS geo_source
           FROM geo.geofences g
           JOIN geo.geofence_events ge
             ON ge.geofence_id = g.id
            AND ge.operating_company_id = $1::uuid
           WHERE g.operating_company_id = $1::uuid
             AND g.label LIKE $2
           GROUP BY g.label`,
          [operating_company_id, `load-${loadId}-stop-%`]
        );
        const geoBySeq = new Map(geoRes.rows.map((r) => [r.sequence_number, r]));

        // Full geofence event stream for the events timeline pop-up.
        const eventStreamRes = await client.query<{
          occurred_at: string;
          event_kind: string;
          source: string | null;
          sequence_number: number | null;
          point_lat: number | null;
          point_lng: number | null;
        }>(
          `SELECT
             ge.occurred_at::text,
             ge.event_kind,
             ge.source::text,
             CAST(SUBSTRING(g.label FROM '-stop-([0-9]+)$') AS integer) AS sequence_number,
             ge.point_lat,
             ge.point_lng
           FROM geo.geofences g
           JOIN geo.geofence_events ge
             ON ge.geofence_id = g.id
            AND ge.operating_company_id = $1::uuid
           WHERE g.operating_company_id = $1::uuid
             AND g.label LIKE $2
           ORDER BY ge.occurred_at ASC`,
          [operating_company_id, `load-${loadId}-stop-%`]
        );

        const legsRes = await client.query<{
          leg_index: number;
          leg_kind: string;
          from_seq: number | null;
          to_seq: number | null;
          from_type: string | null;
          to_type: string | null;
          google_reference_miles: string | null;
        }>(
          `SELECT
             lg.leg_index,
             lg.leg_kind,
             fs.sequence_number AS from_seq,
             ts.sequence_number AS to_seq,
             fs.stop_type::text AS from_type,
             ts.stop_type::text AS to_type,
             lg.google_reference_miles::text
           FROM mdata.load_stop_legs lg
           LEFT JOIN mdata.load_stops fs ON fs.id = lg.from_stop_id
           LEFT JOIN mdata.load_stops ts ON ts.id = lg.to_stop_id
           WHERE lg.load_id = $1 AND lg.operating_company_id = $2::uuid
           ORDER BY lg.leg_index ASC`,
          [loadId, operating_company_id]
        );

        const numOrNull = (v: string | null): number | null => (v == null ? null : Number(v));

        const stops: StopsRecordStop[] = stopsRes.rows.map((stop) => {
          const det = detentionByStop.get(stop.stop_id) ?? null;
          const geo = geoBySeq.get(stop.sequence_number) ?? null;

          const arrivedAt = geo?.geo_entered_at ?? stop.actual_arrival_at ?? null;
          const departedAt = geo?.geo_exited_at ?? stop.actual_departure_at ?? null;

          let dwellMinutes: number | null = null;
          if (arrivedAt && departedAt) {
            dwellMinutes = Math.round((new Date(departedAt).getTime() - new Date(arrivedAt).getTime()) / 60_000);
          }

          const freeTimeMinutes = det ? Number(det.free_time_minutes) : DEFAULT_FREE_TIME_MINUTES;

          let detentionMinutes = 0;
          if (det && arrivedAt) {
            detentionMinutes = computeDetentionBillableMinutes({
              started_at: det.started_at,
              stopped_at: det.stopped_at ?? departedAt,
              free_time_minutes: freeTimeMinutes,
            });
          } else if (dwellMinutes !== null && dwellMinutes > freeTimeMinutes) {
            detentionMinutes = dwellMinutes - freeTimeMinutes;
          }

          const geocodeMissing = stop.latitude == null || stop.longitude == null;

          return {
            stop_id: stop.stop_id,
            sequence: stop.sequence_number,
            stop_type: stop.stop_type,
            address_line1: stop.address_line1,
            city: stop.city,
            state: stop.state,
            postal_code: stop.postal_code,
            country: stop.country,
            latitude: stop.latitude,
            longitude: stop.longitude,
            geocode_precision: stop.geocode_precision,
            geocode_missing: geocodeMissing,
            appointment_window_type: stop.time_window_type,
            appointment_start_at: stop.appointment_start_at,
            appointment_end_at: stop.appointment_end_at,
            scheduled_arrival_at: stop.scheduled_arrival_at,
            arrived_at: arrivedAt,
            departed_at: departedAt,
            dwell_minutes: dwellMinutes,
            free_time_minutes: freeTimeMinutes,
            detention_minutes: detentionMinutes,
            detention_status: (det?.detention_status ?? null) as StopsRecordStop["detention_status"],
            source: sourceLabel(geo?.geo_source ?? stop.actual_arrival_source ?? stop.actual_departure_source ?? null),
            contact_name: stop.site_contact_name,
            contact_phone: stop.site_contact_phone,
            gate_dock_text: stop.gate_dock_text,
            signature_required: stop.signature_required,
            photo_required: stop.photo_required,
            lumper_required: stop.lumper_required,
            lumper_amount_cents: stop.lumper_amount_cents,
            doc_count: Number(stop.doc_count),
          };
        });

        const milesPractical = numOrNull(loadRow.miles_practical);
        const milesShortest = numOrNull(loadRow.miles_shortest);

        const legs: StopsRecordLeg[] = legsRes.rows.map((lg) => {
          const isLoaded = lg.leg_kind === "loaded" || (lg.from_type === "pickup" && lg.to_type === "delivery");
          const isDeadhead = lg.leg_kind === "deadhead" || lg.leg_kind === "empty";
          return {
            leg_index: lg.leg_index,
            leg_kind: lg.leg_kind,
            from_label:
              lg.from_seq != null ? `Stop #${lg.from_seq}${lg.from_type ? ` (${lg.from_type})` : ""}` : "Yard",
            to_label: lg.to_seq != null ? `Stop #${lg.to_seq}${lg.to_type ? ` (${lg.to_type})` : ""}` : "—",
            // Practical/short attributed to the loaded leg from the load; deadhead has neither
            // on this fleet yet (stored at load level, not on a leg → null, never 0).
            practical_miles: isLoaded ? milesPractical : isDeadhead ? null : null,
            short_miles: isLoaded ? milesShortest : null,
            real_miles: null,
            google_reference_miles: numOrNull(lg.google_reference_miles),
          };
        });

        const events: StopsRecordEvent[] = eventStreamRes.rows.map((e) => ({
          occurred_at: e.occurred_at,
          event_kind: e.event_kind,
          source: sourceLabel(e.source),
          sequence: e.sequence_number,
          point_lat: e.point_lat,
          point_lng: e.point_lng,
        }));

        return {
          load: {
            miles_practical: milesPractical,
            miles_shortest: milesShortest,
            miles_deadhead: numOrNull(loadRow.miles_deadhead),
          },
          stops,
          legs,
          events,
          geofence_event_count: events.length,
        } satisfies StopsRecordResponse;
      });

      if (!result) return reply.code(404).send({ error: "load_not_found" });
      return reply.send(result);
    }
  );
}
