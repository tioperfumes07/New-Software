-- Migration: 202613860000_cash_flow_row_adjustments
-- CASH-FLOW-02 owner refinement (2026-09-06 20:2x/20:5xZ): "WE SHOULD BE ABLE TO SELECT IT AND
-- DECIDE IF WE DO NOT WANT IT SHOWING HERE ANYMORE. AND IF A LOAD IS DUE TOMORROW, BUT IT IS
-- LATE IT AUTOMATICALLY CARRIES OVER TO THE NEXT DAY AND IN THE CURRENT DAY THE AMOUNT CHANGES
-- TO 0 BUT STILL STAYS THERE AND STATES DUE TO LATE DELIVERY, OR BREAKDOWN, ETC."
--
-- Two additive tables:
--   catalogs.cash_flow_adjustment_reasons -- seeded reason catalog (income + expense), never a
--     free-text-only field ("Reasons are rows... never free text lost on refresh").
--   accounting.cash_flow_row_adjustments -- append-only ledger of roll-over / hide actions
--     against a Rolling Ledger row (identified by document_kind + document_id, matching
--     apps/backend/src/cash-flow/cash-flow.service.ts's RollingLedgerRow shape). Void-never-
--     delete: a further adjustment on the same row is a NEW row, never an UPDATE/DELETE of a
--     prior one -- the read model resolves "current state" as the latest adjustment per
--     (operating_company_id, document_kind, document_id).
--
-- Additive only. FORCE RLS. No hardcoded UUIDs.

BEGIN;

CREATE TABLE IF NOT EXISTS catalogs.cash_flow_adjustment_reasons (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text          NOT NULL UNIQUE,
  label                 text          NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 200),
  applies_to            text          NOT NULL CHECK (applies_to IN ('income', 'expense', 'both')),
  display_order         integer       NOT NULL DEFAULT 0,
  is_active             boolean       NOT NULL DEFAULT true,
  created_at            timestamptz   NOT NULL DEFAULT now()
);

-- Global reference catalog (entity-neutral, like catalogs.lane_mileage) -- reasons for "the money
-- didn't arrive/get paid on schedule" are not company-specific concepts.
INSERT INTO catalogs.cash_flow_adjustment_reasons (code, label, applies_to, display_order) VALUES
  ('customer_paying_late', 'Customer paying late', 'income', 1),
  ('factor_hold', 'Factor hold', 'both', 2),
  ('dispute', 'Dispute', 'income', 3),
  ('short_pay', 'Short-pay', 'both', 4),
  ('late_delivery', 'Late delivery', 'income', 5),
  ('breakdown', 'Breakdown', 'expense', 6),
  ('other', 'Other', 'both', 99)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE catalogs.cash_flow_adjustment_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogs.cash_flow_adjustment_reasons FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_flow_adjustment_reasons_read_all ON catalogs.cash_flow_adjustment_reasons;
CREATE POLICY cash_flow_adjustment_reasons_read_all
  ON catalogs.cash_flow_adjustment_reasons
  FOR SELECT TO ih35_app
  USING (true);

GRANT SELECT ON catalogs.cash_flow_adjustment_reasons TO ih35_app;

CREATE TABLE IF NOT EXISTS accounting.cash_flow_row_adjustments (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  operating_company_id  uuid          NOT NULL
    REFERENCES org.companies(id) ON DELETE RESTRICT,
  document_kind         text          NOT NULL,
  document_id           uuid          NOT NULL,
  original_due_date     date          NOT NULL,
  -- NULL projected_due_date means this adjustment is a HIDE action, not a roll-over.
  projected_due_date    date          NULL,
  reason_id             uuid          NOT NULL
    REFERENCES catalogs.cash_flow_adjustment_reasons(id) ON DELETE RESTRICT,
  note                  text          NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  -- Roll-over-not-hide rows: hidden_at stays NULL. Hide rows (or a roll-over the owner also
  -- chose to hide): hidden_at/hidden_reason/hidden_by_user_id are set together.
  hidden_at             timestamptz   NULL,
  hidden_reason         text          NULL CHECK (hidden_reason IS NULL OR char_length(trim(hidden_reason)) BETWEEN 1 AND 500),
  hidden_by_user_id     uuid          NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  created_by_user_id    uuid          NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  CHECK (
    (hidden_at IS NULL AND hidden_reason IS NULL AND hidden_by_user_id IS NULL)
    OR (hidden_at IS NOT NULL AND hidden_reason IS NOT NULL AND hidden_by_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS cash_flow_row_adjustments_row_idx
  ON accounting.cash_flow_row_adjustments (operating_company_id, document_kind, document_id, created_at DESC);

ALTER TABLE accounting.cash_flow_row_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.cash_flow_row_adjustments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_flow_row_adjustments_company_isolation ON accounting.cash_flow_row_adjustments;
CREATE POLICY cash_flow_row_adjustments_company_isolation
  ON accounting.cash_flow_row_adjustments
  FOR ALL TO ih35_app
  USING (
    operating_company_id = NULLIF(current_setting('app.operating_company_id', true), '')::uuid
  )
  WITH CHECK (
    operating_company_id = NULLIF(current_setting('app.operating_company_id', true), '')::uuid
  );

-- WORM: an adjustment row is a historical audit fact -- once written it is never updated or
-- deleted, only superseded by a newer row (same pattern as accounting.cash_flow_adjustments'
-- own "ARCHIVE never DELETE" convention, one level stricter since even archival happens by
-- inserting a new row, not mutating this one).
CREATE OR REPLACE FUNCTION accounting.cash_flow_row_adjustments_worm_guard()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'accounting.cash_flow_row_adjustments is append-only (WORM) -- % is forbidden, insert a new adjustment instead', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cash_flow_row_adjustments_worm ON accounting.cash_flow_row_adjustments;
CREATE TRIGGER trg_cash_flow_row_adjustments_worm
  BEFORE UPDATE OR DELETE ON accounting.cash_flow_row_adjustments
  FOR EACH ROW EXECUTE FUNCTION accounting.cash_flow_row_adjustments_worm_guard();

GRANT SELECT, INSERT ON accounting.cash_flow_row_adjustments TO ih35_app;

COMMIT;
