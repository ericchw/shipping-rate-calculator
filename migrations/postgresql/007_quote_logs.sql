BEGIN;
SELECT pg_advisory_xact_lock(83192647);
CREATE TABLE IF NOT EXISTS quote_logs (
 id UUID PRIMARY KEY, group_id UUID NOT NULL REFERENCES company_groups(id), user_id UUID REFERENCES users(id) ON DELETE SET NULL,
 mode TEXT NOT NULL CHECK(mode IN ('sandbox','production')), shipment_json TEXT NOT NULL, comparison_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quote_logs_group ON quote_logs(group_id,mode,created_at);
INSERT INTO schema_migrations VALUES (7,to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ON CONFLICT DO NOTHING;
COMMIT;
