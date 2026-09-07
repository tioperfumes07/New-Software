-- MANUAL-DELIVERY-AUTH-01 (owner request 2026-09-07): some customer + factoring agreements permit
-- invoicing and factoring a load BEFORE the truck is physically empty/departed the delivery stop --
-- the signed POD/BOL is already in hand, customer and factoring have both agreed to accept it early.
-- The revenue-recognition Event 1 evidence gate (finalActiveDeliveryDepartureAt,
-- revrec-delivery-posting/poster.service.ts, owner-approved Option B 2026-08-01) deliberately refuses
-- to earn on anything but a real captured mdata.load_stops.actual_departure_at, specifically to
-- prevent a fabricated timestamp under a revenue entry. This migration does NOT touch that gate or
-- fabricate stop data -- it adds an explicit, reason-required, role-gated AUTHORIZATION record that
-- the poster additionally recognizes as alternate evidence, always distinguishable from real stop
-- evidence in the audit trail (never silently conflated with it). mdata.loads.status and the real
-- delivery stop timestamps are NEVER touched by this path -- the truck's real operational status stays
-- exactly what it is; only the FINANCIAL/billing side is authorized early, on the record.
BEGIN;

CREATE TABLE IF NOT EXISTS dispatch.manual_delivery_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operating_company_id uuid NOT NULL REFERENCES org.companies(id),
  load_id uuid NOT NULL REFERENCES mdata.loads(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(btrim(reason)) >= 20),
  customer_authorized boolean NOT NULL,
  factoring_authorized boolean NOT NULL,
  pod_document_id uuid NULL REFERENCES dispatch.pod_documents(id),
  authorized_by_user_id uuid NOT NULL REFERENCES identity.users(id),
  authorized_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  revoked_by_user_id uuid NULL REFERENCES identity.users(id),
  revoke_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manual_delivery_auth_both_confirmed
    CHECK (customer_authorized = true AND factoring_authorized = true)
);

-- One ACTIVE (non-revoked) authorization per load -- re-authorizing an already-authorized load is a
-- conflict the API surfaces explicitly, not a silent second row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_delivery_auth_active_load
  ON dispatch.manual_delivery_authorizations (operating_company_id, load_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_manual_delivery_auth_load
  ON dispatch.manual_delivery_authorizations (load_id, authorized_at DESC);

ALTER TABLE dispatch.manual_delivery_authorizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manual_delivery_auth_company_scope ON dispatch.manual_delivery_authorizations;
CREATE POLICY manual_delivery_auth_company_scope
  ON dispatch.manual_delivery_authorizations
  FOR ALL TO ih35_app
  USING (
    operating_company_id = NULLIF(current_setting('app.operating_company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'lucia'
  )
  WITH CHECK (
    operating_company_id = NULLIF(current_setting('app.operating_company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'lucia'
  );

GRANT SELECT, INSERT, UPDATE ON dispatch.manual_delivery_authorizations TO ih35_app;

-- dispatch.pod_documents gains a `source` column so a manually-authorized POD row (created by this
-- new flow, not the driver app) is ALWAYS distinguishable in the audit trail from a real driver
-- capture -- never silently indistinguishable, matching the same traceability standard as every other
-- override in this codebase (void-not-delete, evidence-source tagging, etc).
ALTER TABLE dispatch.pod_documents
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'driver_app'
    CHECK (source IN ('driver_app', 'manual_office_authorization'));

COMMIT;
