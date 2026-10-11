BEGIN;
SELECT pg_advisory_xact_lock(83192647);
CREATE TABLE IF NOT EXISTS account_access (user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, web_access INTEGER NOT NULL DEFAULT 1 CHECK(web_access IN (0,1)), api_access INTEGER NOT NULL DEFAULT 1 CHECK(api_access IN (0,1)));
CREATE TABLE IF NOT EXISTS session_channels (token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE, channel TEXT NOT NULL CHECK(channel IN ('web','api')));
INSERT INTO schema_migrations VALUES (3,to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ON CONFLICT DO NOTHING;
COMMIT;
