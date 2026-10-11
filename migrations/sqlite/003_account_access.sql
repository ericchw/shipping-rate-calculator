BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS account_access (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, web_access INTEGER NOT NULL DEFAULT 1 CHECK(web_access IN (0,1)), api_access INTEGER NOT NULL DEFAULT 1 CHECK(api_access IN (0,1)));
CREATE TABLE IF NOT EXISTS session_channels (token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE, channel TEXT NOT NULL CHECK(channel IN ('web','api')));
INSERT OR IGNORE INTO schema_migrations VALUES (3,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
COMMIT;
