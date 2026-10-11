CREATE TABLE IF NOT EXISTS carrier_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  carrier TEXT NOT NULL CHECK(carrier IN ('canada_post','fedex','loomis')),
  mode TEXT NOT NULL CHECK(mode IN ('sandbox','production')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  encrypted_settings TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id,carrier,mode)
);
INSERT OR IGNORE INTO schema_migrations VALUES (2,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
