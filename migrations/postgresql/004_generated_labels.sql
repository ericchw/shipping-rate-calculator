BEGIN;
SELECT pg_advisory_xact_lock(83192647);
CREATE TABLE IF NOT EXISTS generated_labels (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK(mode IN ('sandbox','production')),
  service_code TEXT NOT NULL,
  label_id TEXT NOT NULL,
  shipment_number TEXT NOT NULL,
  shipment_json TEXT NOT NULL,
  labels_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS generated_labels_owner ON generated_labels(user_id,mode,created_at);
INSERT INTO schema_migrations VALUES (4,to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ON CONFLICT DO NOTHING;
COMMIT;
