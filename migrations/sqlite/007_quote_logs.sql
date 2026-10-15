BEGIN;

CREATE TABLE IF NOT EXISTS quote_logs (
 id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES company_groups(id), user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 mode TEXT NOT NULL CHECK(mode IN ('sandbox','production')), shipment_json TEXT NOT NULL, comparison_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quote_logs_group ON quote_logs(group_id,mode,created_at);
INSERT INTO schema_migrations VALUES (7,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING;
COMMIT;
