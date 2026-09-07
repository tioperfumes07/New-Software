-- LDT-5 (lead, 2026-09-06): the Pre-Settlement read model (pre-settlement.routes.ts) filters
-- driver_finance.driver_settlements on settlement_model = 'load_bookended', but the booking-time link
-- (presettlement-link.service.ts confirmPresettlementLink) never set settlement_model. Measured on Neon
-- 2026-09-06 01:5xZ: 15 of 15 open USMCA settlements carry settlement_model NULL — every one of them
-- created by the link (first_load_id set, display_id S-<n>). That is why the live tab said
-- "No active pre-settlement found for this driver" while the load carried presettlement_link_id.
-- Additive, idempotent: only rows the link created (first_load_id IS NOT NULL) and only where NULL.
UPDATE driver_finance.driver_settlements
SET settlement_model = 'load_bookended'
WHERE settlement_model IS NULL
  AND first_load_id IS NOT NULL;
