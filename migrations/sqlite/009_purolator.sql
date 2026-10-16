BEGIN;
-- Rebuild preserves ciphertext, owner/mode keys and enablement unchanged.
CREATE TABLE IF NOT EXISTS group_carrier_settings_v9 (
  group_id TEXT NOT NULL REFERENCES company_groups(id),
  carrier TEXT NOT NULL CHECK(carrier IN ('canada_post','loomis','fedex','purolator')),
  mode TEXT NOT NULL CHECK(mode IN ('sandbox','production')),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  encrypted_settings TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(group_id,carrier,mode)
);
INSERT INTO group_carrier_settings_v9 SELECT * FROM group_carrier_settings;
DROP TABLE group_carrier_settings;
ALTER TABLE group_carrier_settings_v9 RENAME TO group_carrier_settings;
INSERT INTO schema_migrations VALUES (9,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING;
COMMIT;
