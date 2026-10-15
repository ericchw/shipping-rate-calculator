BEGIN;
CREATE TABLE IF NOT EXISTS generation_settings (mode TEXT PRIMARY KEY CHECK(mode IN ('sandbox','production')), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)));
INSERT OR IGNORE INTO schema_migrations VALUES (5,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
COMMIT;
