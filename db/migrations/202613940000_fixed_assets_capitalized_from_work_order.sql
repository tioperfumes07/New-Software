-- ACCT-F26027 -- GUARD-WORKORDERS DEPRECIATION-REGISTER-DEFERRED-VS-NEVER-DEFER (routed=CC-1, filed 2026-09-01).
--
-- A WO-close severe repair >= $7,000 (accounting/capitalize-threshold.ts's
-- decideRepairBooksTreatment) already posts the GL debit to the fixed_asset_default
-- role account (maintenance-posting/poster.service.ts), but never creates a matching
-- accounting.fixed_assets register row -- so the capitalized cost never enters the
-- per-asset depreciation schedule / FIXED_ASSET_AUTOPOST_ENABLED cron engine. This
-- additive column lets the follow-up code fix (owned-unit-fixed-asset-register.service.ts's
-- new registerCapitalizedRepairAsFixedAsset) record which work order a register row was
-- capitalized from, and stay idempotent per WO (never double-book on a retry/reuse of the
-- same WO-close bill).
--
-- Nullable, no backfill (only forward WO closes create these rows -- same always-SUPPLIED-
-- on-write, no-backfill pattern this file already uses for other optional columns).

ALTER TABLE accounting.fixed_assets
  ADD COLUMN IF NOT EXISTS capitalized_from_work_order_id uuid NULL
    REFERENCES maintenance.work_orders(id);

-- One capitalized-repair asset row per work order, enforced at the DB level (idempotency
-- must not rely on the app-level SELECT-before-INSERT check alone). Also serves as the
-- lookup index for the WO -> register-row join.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_assets_one_per_capitalized_wo
  ON accounting.fixed_assets (capitalized_from_work_order_id)
  WHERE capitalized_from_work_order_id IS NOT NULL
    AND deleted_at IS NULL
    AND voided_at IS NULL;
