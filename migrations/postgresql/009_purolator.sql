BEGIN;
SELECT pg_advisory_xact_lock(83192647);
ALTER TABLE group_carrier_settings DROP CONSTRAINT IF EXISTS group_carrier_settings_carrier_check;
ALTER TABLE group_carrier_settings ADD CONSTRAINT group_carrier_settings_carrier_check CHECK(carrier IN ('canada_post','loomis','fedex','purolator'));
INSERT INTO schema_migrations VALUES (9,to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ON CONFLICT DO NOTHING;
COMMIT;
