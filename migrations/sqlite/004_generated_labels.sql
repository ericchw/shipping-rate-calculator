BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS generated_labels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK(mode IN ('sandbox','production')),
  service_code TEXT NOT NULL,
  label_id TEXT NOT NULL,
  shipment_number TEXT NOT NULL,
  shipment_json TEXT NOT NULL,
  labels_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS generated_labels_owner ON generated_labels(user_id,mode,created_at);
INSERT OR IGNORE INTO schema_migrations VALUES (4,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
COMMIT;
