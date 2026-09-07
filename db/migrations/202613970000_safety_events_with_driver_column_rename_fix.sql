-- SAFETY-BROKEN-VIEW (owner QA finding 50345, routed 2026-09-07): views.safety_events_with_driver has
-- been stuck on migration 0045's EMPTY fallback branch (`SELECT ... WHERE false`) on prod since it was
-- created -- at the time 0045 ran, either safety.safety_events or mdata.drivers did not yet exist, so
-- the conditional DO block installed the always-empty stub and nothing ever recreated the real view.
-- Separately, 0045's own "real" branch would have failed to compile against the CURRENT
-- safety.safety_events schema even if re-run as-is: it selects se.driver_id/se.unit_id/se.event_at/
-- se.source/se.spawned_liability_id/se.spawned_wo_id, but the live table has subject_driver_id/
-- subject_unit_id/occurred_at instead, and no source/spawned_liability_id/spawned_wo_id columns at
-- all (confirmed live via information_schema.columns, 2026-09-07).
--
-- Downstream impact: safety.v_safety_events_with_active (built ON TOP of this view) and both
-- GET /api/v1/safety/events (list) and GET /api/v1/safety/events/:id (detail) all read through this
-- chain, so the entire Safety Events surface returned zero rows on prod while USMCA has 7 real open
-- events (ages 9-46 days). apps/backend/src/safety/safety.routes.ts's dashboard-KPI route already
-- documented this exact defect in its own comment and routed around the view entirely for KPIs; the
-- Events list/detail routes were never given the same treatment, so they stayed broken.
--
-- Fix: rewrite the "real" branch to alias the CURRENT column names onto the SAME output shape every
-- downstream consumer (safety.v_safety_events_with_active, safety.routes.ts, SafetyEventsTable.tsx)
-- already expects -- driver_id/unit_id/event_at -- via straight column aliases, no data invented.
-- `source`, `spawned_liability_id` and `spawned_wo_id` have no backing column on safety.safety_events
-- today (a generic safety event is not itself an accident-with-spawned-liability record -- that
-- concept lives in the dedicated accidents endpoint/table, which already returns its own real
-- spawned_liability_id via safety.routes.ts's computed field, untouched here) -- kept as honest NULL
-- placeholders so the output shape matches downstream `SELECT *` consumers without fabricating data.
BEGIN;

DO $$
BEGIN
  IF to_regclass('safety.safety_events') IS NOT NULL
     AND to_regclass('mdata.drivers') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'safety' AND table_name = 'safety_events' AND column_name = 'subject_driver_id'
     )
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'safety' AND table_name = 'safety_events' AND column_name = 'occurred_at'
     ) THEN
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW views.safety_events_with_driver
      WITH (security_invoker = true) AS
      SELECT
        se.id,
        se.operating_company_id,
        se.subject_driver_id AS driver_id,
        se.subject_unit_id AS unit_id,
        se.event_type,
        se.severity,
        se.occurred_at AS event_at,
        se.description,
        NULL::text AS source,
        se.status,
        NULL::uuid AS spawned_liability_id,
        NULL::uuid AS spawned_wo_id,
        NULLIF(CONCAT_WS(' ', d.first_name, d.last_name), '') AS driver_full_name,
        d.id::text AS driver_display_id,
        COALESCE(u.unit_number, u.id::text) AS unit_display_id
      FROM safety.safety_events se
      -- LEFT JOIN, not JOIN: live data has real open events with subject_type='company' and no
      -- subject_driver_id at all (5 of 7 open USMCA events at fix time) -- an INNER join here would
      -- silently drop those rows again, reproducing this same class of defect under a different name.
      LEFT JOIN mdata.drivers d ON d.id = se.subject_driver_id
      LEFT JOIN mdata.units u ON u.id = se.subject_unit_id
      ORDER BY se.occurred_at DESC
    $VIEW$;
  END IF;
END
$$;

COMMIT;
