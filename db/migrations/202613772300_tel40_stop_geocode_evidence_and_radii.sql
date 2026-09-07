-- TEL-40: durable stop geocode evidence and explicit enter/exit radii.
-- Meaning: operational location evidence; no financial records and no Samsara place push.
BEGIN;
ALTER TABLE mdata.load_stops ADD COLUMN IF NOT EXISTS geocode_source text;
ALTER TABLE mdata.load_stops ADD COLUMN IF NOT EXISTS geocode_confidence numeric;
ALTER TABLE mdata.load_stops ADD COLUMN IF NOT EXISTS geocode_failure_reason text;
ALTER TABLE mdata.load_stops ADD COLUMN IF NOT EXISTS geocode_attempted_at timestamptz;
ALTER TABLE mdata.load_stops DROP CONSTRAINT IF EXISTS load_stops_geocode_confidence_check;
ALTER TABLE mdata.load_stops ADD CONSTRAINT load_stops_geocode_confidence_check CHECK (geocode_confidence IS NULL OR geocode_confidence BETWEEN 0 AND 1);
ALTER TABLE mdata.load_stops DROP CONSTRAINT IF EXISTS load_stops_coordinates_not_zero_check;
ALTER TABLE mdata.load_stops ADD CONSTRAINT load_stops_coordinates_not_zero_check CHECK (latitude IS NULL OR longitude IS NULL OR latitude <> 0 OR longitude <> 0);
ALTER TABLE geo.geofences ADD COLUMN IF NOT EXISTS enter_radius_m integer NOT NULL DEFAULT 402;
ALTER TABLE geo.geofences ADD COLUMN IF NOT EXISTS exit_radius_m integer NOT NULL DEFAULT 805;
ALTER TABLE geo.geofences DROP CONSTRAINT IF EXISTS geo_geofences_radius_order_check;
ALTER TABLE geo.geofences ADD CONSTRAINT geo_geofences_radius_order_check CHECK (enter_radius_m > 0 AND exit_radius_m >= enter_radius_m);
CREATE INDEX IF NOT EXISTS idx_locations_normalized_address ON mdata.locations
  (operating_company_id, lower(coalesce(address_line1,'')), lower(coalesce(city,'')), upper(coalesce(state,'')), lower(coalesce(postal_code,'')))
  WHERE deactivated_at IS NULL;
COMMIT;
