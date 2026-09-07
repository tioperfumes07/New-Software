-- ACC-MIG — mdata.load_stop_legs (lead handoff via docs/bus/INBOX-CC-1.md, CC-2's DSP-48).
-- DSP-48 (owner ruling 2026-09-05, "LAW §2 row: Google distance = REFERENCE ONLY") persists one
-- Google Routes computeRoutes distance per leg of a load's practical route (yard->pickup "empty"
-- leg, plus one row per pickup->...->delivery "practical" segment) purely for operator comparison
-- against the typed Practical/Short miles. This table is a pure forward-ref today:
-- apps/backend/src/dispatch/google-reference-miles.service.ts already INSERTs/UPDATEs into it
-- (degrade-safe on relation-absent 42P01/42703, so booking never broke while this was pending) and
-- apps/backend/src/cron/google-reference-miles-expiry-cron.ts already nulls out rows older than 30
-- days (Google ToS). This migration creates the exact table/column shape those two already-live
-- call sites expect — no code change needed there once this lands.
--
-- LAW §2 / NO-MONEY-LINKAGE BY DESIGN: no FK to any bill/settlement/pay table, so these numbers can
-- never enter a financial calculation (enforced independently by
-- scripts/verify-google-reference-miles.mjs at every call site touching miles_practical/shortest).
--
-- Idempotent (CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS) — safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS mdata.load_stop_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid NOT NULL REFERENCES mdata.loads(id) ON DELETE CASCADE,
  operating_company_id uuid NOT NULL REFERENCES org.companies(id),
  leg_index int NOT NULL,
  leg_kind text NOT NULL CHECK (leg_kind IN ('empty', 'practical')),
  from_stop_id uuid REFERENCES mdata.load_stops(id), -- NULL for the yard-origin "empty" leg
  to_stop_id uuid NOT NULL REFERENCES mdata.load_stops(id),
  google_reference_miles numeric(9, 1),
  google_reference_fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT load_stop_legs_load_id_leg_index_key UNIQUE (load_id, leg_index)
);

CREATE INDEX IF NOT EXISTS idx_load_stop_legs_company
  ON mdata.load_stop_legs (operating_company_id);

CREATE INDEX IF NOT EXISTS idx_load_stop_legs_load
  ON mdata.load_stop_legs (load_id);

-- Entity-scoped FORCED RLS, same predicate as every other mdata.* table this session
-- (see mdata.load_commodities-style catalogs / dispatch.detention_requests).
ALTER TABLE mdata.load_stop_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mdata.load_stop_legs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS load_stop_legs_entity_scope ON mdata.load_stop_legs;
CREATE POLICY load_stop_legs_entity_scope ON mdata.load_stop_legs
  FOR ALL TO ih35_app
  USING (
    identity.is_lucia_bypass()
    OR operating_company_id::text = current_setting('app.operating_company_id', true)
  )
  WITH CHECK (
    identity.is_lucia_bypass()
    OR operating_company_id::text = current_setting('app.operating_company_id', true)
  );

-- 0065-style self-contained grant block (same pattern as every other net-new mdata/dispatch table
-- this session — don't rely solely on 0065's ALTER DEFAULT PRIVILEGES, which is role-scoped to
-- whichever role ran that migration, not necessarily the role that runs this one).
GRANT USAGE ON SCHEMA mdata TO ih35_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON mdata.load_stop_legs TO ih35_app;

COMMIT;
