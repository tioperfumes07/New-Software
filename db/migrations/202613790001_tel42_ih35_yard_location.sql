BEGIN;

-- TEL-42: mdata.locations is master data, so its retirement column is deactivated_at.
-- Owner-ruling coordinates are authoritative: this migration never re-geocodes the yard.
-- REHEARSED: 2026-09-05 — applied twice inside one explicit transaction against production-shaped Neon, then ROLLBACK; one yard + linked fence + radius 76 proved.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mdata_locations_one_ih35_yard_per_company
  ON mdata.locations (operating_company_id)
  WHERE is_ih35_yard AND deactivated_at IS NULL;

INSERT INTO mdata.locations (
  operating_company_id, location_name, location_type, address_line1, city, state,
  postal_code, country, latitude, longitude, is_ih35_yard, geocoded_at, geocoding_source
)
SELECT
  c.id,
  'IH35 Yard — 23918 Mines Rd', 'yard'::mdata.location_type_enum,
  '23918 Mines Rd', 'Laredo', 'TX', '78045', 'US',
  27.65149, -99.63094, true, now(), 'owner_ruling_2026-09-05'
FROM org.companies c
WHERE c.id = '5c854333-6ea5-4faa-af31-67cb272fef80'::uuid
  AND NOT EXISTS (
  SELECT 1 FROM mdata.locations
   WHERE operating_company_id = '5c854333-6ea5-4faa-af31-67cb272fef80'::uuid
     AND is_ih35_yard AND deactivated_at IS NULL
);

UPDATE mdata.locations
   SET location_name = 'IH35 Yard — 23918 Mines Rd',
       location_type = 'yard'::mdata.location_type_enum,
       address_line1 = '23918 Mines Rd', city = 'Laredo', state = 'TX',
       postal_code = '78045', country = 'US',
       latitude = 27.65149, longitude = -99.63094,
       geocoded_at = coalesce(geocoded_at, now()),
       geocoding_source = 'owner_ruling_2026-09-05', updated_at = now()
 WHERE operating_company_id = '5c854333-6ea5-4faa-af31-67cb272fef80'::uuid
   AND is_ih35_yard AND deactivated_at IS NULL;

DO $$
DECLARE yard_id uuid;
BEGIN
  SELECT id INTO yard_id
    FROM mdata.locations
   WHERE operating_company_id = '5c854333-6ea5-4faa-af31-67cb272fef80'::uuid
     AND is_ih35_yard AND deactivated_at IS NULL;

  IF yard_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE geo.geofences
     SET location_ref_id = yard_id,
         center_lat = 27.65149,
         center_lng = -99.63094,
         radius_m = 76,
         updated_at = now()
   WHERE id = '188cf90c-d970-4ab0-9795-d23394b38af1'::uuid
     AND operating_company_id = '5c854333-6ea5-4faa-af31-67cb272fef80'::uuid;
END $$;

COMMIT;
