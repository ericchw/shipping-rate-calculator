BEGIN;
CREATE TABLE IF NOT EXISTS account_environment_access (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 production_access INTEGER NOT NULL DEFAULT 0 CHECK(production_access IN (0,1)),
 uat_access INTEGER NOT NULL DEFAULT 1 CHECK(uat_access IN (0,1))
);
INSERT INTO account_environment_access(user_id,production_access,uat_access)
SELECT id,1,1 FROM users WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=8)
ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations VALUES (8,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING;
COMMIT;
