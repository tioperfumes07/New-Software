-- 202613850000_trip_type_local_enum.sql
-- TRIP-LOCAL-ENUM (owner order 2026-09-06). mdata.trip_type_enum (202606181500) only ever had
-- 'NB' | 'TR' | 'SB' -- a Laredo->Laredo trip (pickup and delivery both in Laredo, no border
-- crossing, no northbound/triangulation/southbound leg at all) has never had a value to record
-- itself as. Owner law: Laredo->Laredo = LOCAL. One live load today (13544).
--
-- Additive, idempotent, reversible (a value once added to a live enum cannot be cleanly dropped
-- without a full type rebuild -- documented below, not attempted here; no data uses it yet on
-- prod so this is a true no-op risk).
--
-- Reversible (manual down, only safe before any row uses 'LOCAL' --
-- verify with: SELECT count(*) FROM mdata.loads WHERE trip_type = 'LOCAL'):
--   Postgres cannot DROP a single enum value. Rebuild: CREATE TYPE mdata.trip_type_enum_old AS
--   ENUM ('NB','TR','SB'); ALTER TABLE mdata.loads ALTER COLUMN trip_type TYPE
--   mdata.trip_type_enum_old USING trip_type::text::mdata.trip_type_enum_old; DROP TYPE
--   mdata.trip_type_enum; ALTER TYPE mdata.trip_type_enum_old RENAME TO mdata.trip_type_enum;

BEGIN;

ALTER TYPE mdata.trip_type_enum ADD VALUE IF NOT EXISTS 'LOCAL' AFTER 'SB';

COMMIT;
