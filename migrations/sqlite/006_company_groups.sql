BEGIN;

CREATE TABLE IF NOT EXISTS company_groups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name)>0), created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS company_groups_name ON company_groups(lower(name));
CREATE TABLE IF NOT EXISTS group_memberships (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES company_groups(id)
);
CREATE INDEX IF NOT EXISTS group_memberships_group ON group_memberships(group_id);
CREATE TABLE IF NOT EXISTS group_carrier_settings (
  group_id TEXT NOT NULL REFERENCES company_groups(id), carrier TEXT NOT NULL CHECK(carrier IN ('canada_post','loomis','fedex')),
  mode TEXT NOT NULL CHECK(mode IN ('sandbox','production')), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  encrypted_settings TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(group_id,carrier,mode)
);
CREATE TABLE IF NOT EXISTS group_generation_settings (
  group_id TEXT NOT NULL REFERENCES company_groups(id), mode TEXT NOT NULL CHECK(mode IN ('sandbox','production')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), PRIMARY KEY(group_id,mode)
);
CREATE TABLE IF NOT EXISTS company_labels (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES company_groups(id),
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK(mode IN ('sandbox','production')), service_code TEXT NOT NULL,
  label_id TEXT NOT NULL, shipment_number TEXT NOT NULL, shipment_json TEXT NOT NULL, labels_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS company_labels_group ON company_labels(group_id,mode,created_at);
-- Initial groups use the previous owner ID, preserving authenticated encryption context.
INSERT INTO company_groups(id,name,created_at) SELECT id,email,created_at FROM users WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=6) ON CONFLICT DO NOTHING;
INSERT INTO group_memberships(user_id,group_id) SELECT id,id FROM users WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=6) ON CONFLICT DO NOTHING;
INSERT INTO group_carrier_settings(group_id,carrier,mode,enabled,encrypted_settings,updated_at)
  SELECT user_id,carrier,mode,enabled,encrypted_settings,updated_at FROM carrier_settings WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=6) ON CONFLICT DO NOTHING;
INSERT INTO company_labels(id,group_id,user_id,mode,service_code,label_id,shipment_number,shipment_json,labels_json,created_at)
  SELECT id,user_id,user_id,mode,service_code,label_id,shipment_number,shipment_json,labels_json,created_at FROM generated_labels WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=6) ON CONFLICT DO NOTHING;
INSERT INTO group_generation_settings(group_id,mode,enabled)
  SELECT g.id,s.mode,s.enabled FROM company_groups g CROSS JOIN generation_settings s WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=6) ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations VALUES (6,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING;
COMMIT;
