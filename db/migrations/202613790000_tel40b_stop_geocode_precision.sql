-- TEL-40b: classify stop coordinates so locality centroids can never create arrival fences.
-- Canonical void convention: mdata.load_stops uses soft_deleted_at historically; no new lifecycle column here.
ALTER TABLE mdata.load_stops
  ADD COLUMN IF NOT EXISTS geocode_precision text;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mdata.load_stops'::regclass
      AND conname = 'load_stops_geocode_precision_check'
  ) THEN
    ALTER TABLE mdata.load_stops
      ADD CONSTRAINT load_stops_geocode_precision_check
      CHECK (geocode_precision IS NULL OR geocode_precision IN ('rooftop','range','locality'));
  END IF;
END
$migration$;

-- Existing TEL-40 stop/location evidence was created only from a canonical stored location.
UPDATE mdata.load_stops
SET geocode_precision = 'range'
WHERE geocode_precision IS NULL
  AND latitude IS NOT NULL
  AND longitude IS NOT NULL
  AND geocode_source = 'location_existing';
