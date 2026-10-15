# PostgreSQL and SQLite

PostgreSQL is the primary setup in the environment templates. SQLite remains an equivalent option for a local installation. Both store users, Web/API access grants, hashed sessions and their channels, company groups, memberships, encrypted group carrier settings, saved company labels, and private saved origin profiles; normalized quote comparisons and shipment details are saved as company rate logs; raw carrier response blobs are not stored. The server reads the provider at startup. Changing databases requires a restart and cannot be done by an untrusted browser request.

## Local Docker startup

`npm run dev` runs compose.dev.yml with local.env. The web container uses Node 22 and connects to PostgreSQL at the internal postgres hostname, overriding any host DATABASE_URL. Startup applies migrations and creates the configured login only when that email is missing. Existing account passwords and profiles are preserved. This stack has its own persistent sandbox-postgres-data volume; an earlier host database is not automatically imported. `npm run dev:stop` preserves the volume.

## PostgreSQL: local setup

Use Node.js 22.16 or newer and pnpm 10. Install dependencies, copy `env/local.env.example` to `env/local.env`, and fill in the empty `DATABASE_URL` and `POSTGRES_PASSWORD` fields locally. Use a random hexadecimal password so it is also safe inside the connection URL. Never publish that file.

```sh
pnpm install
docker compose --env-file env/local.env -f compose.database.yml up -d
pnpm db:migrate
pnpm user:create
pnpm dev:app
```

Set `USER_EMAIL`, `USER_PASSWORD` (at least 6 characters), and `CREATE_USER_ROLE=admin` locally to provision the initial administrator. Then create users and assign company groups through Admin. Remove the provisioning password afterwards. There is no shared default account or password.

```dotenv
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://shipping:YOUR_LOCAL_PASSWORD@127.0.0.1:5432/shipping
POSTGRES_PASSWORD=YOUR_LOCAL_PASSWORD
```

The PostgreSQL container binds only to the loopback interface. A named volume persists its data. `docker compose down` preserves that volume; do not use `down -v` unless you intend to erase it. Changing `POSTGRES_PASSWORD` after the volume has been initialized does not rotate the existing database role password; rotate the role separately and update the URL together.

## SQLite: switch the setting

Stop the web server, set the following in your existing `env/local.env`, run migrations, and restart. For a new installation, copy `env/local.env.example` first, then select SQLite using these settings. Retain any carrier configuration when switching.

```dotenv
DATABASE_PROVIDER=sqlite
DATABASE_URL=file:./data/shipping.db
```

```sh
pnpm db:migrate
pnpm user:create
pnpm dev:app
```

SQLite needs no database service. Node's built-in SQLite driver uses foreign keys, WAL journaling, a busy timeout, and serialized write transactions. Node 22 may print an experimental SQLite warning. Use a single application instance with a local persistent disk. Do not share the SQLite file through a network filesystem. Use PostgreSQL for multiple replicas.

## Production Docker deployment

Configure env/production.env with a real HTTPS APP_ORIGIN, hexadecimal POSTGRES_PASSWORD, USER_EMAIL and quoted USER_PASSWORD (6+ characters). Both production and sandbox carrier areas are served by the same deployment.

```sh
npm run dev:stop
npm run docker:production
npm run docker:production:logs
```

This uses compose.yml plus compose.postgres.yml in a separate shipping-production project, supplies the internal PostgreSQL URL, waits for database health, applies migrations, and provisions the configured account only if missing. Passwords, roles and profiles of existing accounts are preserved. If both login fields are absent, provisioning is skipped. The hosted and local Docker deployments have separate database volumes. Production and sandbox areas within one deployment share accounts and profiles, with separate carrier credentials.

Use npm run docker:production:stop to stop while preserving data. To return to the local runtime, stop the hosted stack and run npm run dev. Carrier modes are selected by URL, not Docker switching. Production browser login requires an HTTPS reverse proxy because sessions use Secure cookies. See [deployment instructions](../README.md#deployment-environment-files).

For a managed remote PostgreSQL database, use compose.yml alone with its provider URL and TLS settings. For SQLite, use compose.yml alone with DATABASE_PROVIDER=sqlite and DATABASE_URL=file:/app/data/shipping.db. Both apply migrations and optionally provision accounts at startup. Neither variant uses the docker:production shortcut, which includes local PostgreSQL. Never disable database TLS certificate verification.

## Moving existing data

Changing settings connects to a different database. It does not copy profiles, users, or sessions. For a fresh database, apply migrations and provision users. For preserving existing users and profiles, stop writes, back up the source, then use `pnpm db:transfer` as documented below. Sessions, label history and encrypted carrier settings are intentionally not transferred; users sign in again and reconfigure carriers. Apply current migrations to the source before transfer.

Configure `SOURCE_DATABASE_PROVIDER`, `SOURCE_DATABASE_URL`, `TARGET_DATABASE_PROVIDER`, and `TARGET_DATABASE_URL` in the ignored local environment. Run `pnpm db:transfer`. The target must be empty; the tool preserves user/profile IDs and password hashes, runs target migrations, validates record ownership and defaults, and writes users, account access grants, company groups, memberships and profiles in one transaction. Afterwards point the app at the target and restart. Keep the source backup until you have verified profile names, counts, defaults, and a login. Never commit database exports or backups.

## Migrations, ownership, and retention

Provider-specific SQL lives in `migrations/sqlite` and `migrations/postgresql`. Migration 001 is idempotent and versioned. Both enforce foreign keys, a case-insensitive profile-name index per user, and at most one default via a partial unique index. Profile writes serialize on the owner inside a transaction, protecting concurrent default changes. API operations derive ownership from the session; API keys are not end-user identities.

Deleting a profile removes it from active storage. Deleting a user through an administrator's database maintenance process cascades to profiles and sessions. Backups retain deleted data until their configured retention expires. Encrypt production disks/backups and restrict database access. Back up SQLite with its backup API or while the app is stopped (include WAL state); use `pg_dump` for PostgreSQL. Do not log addresses, credentials, raw SQL parameters, or exported records.

## Verification

`pnpm test` covers SQLite ownership and defaults. Set `TEST_POSTGRES_URL` to a dedicated disposable PostgreSQL test database and run `pnpm test:postgres` to exercise the equivalent contract. It uses synthetic randomly identified users and removes them after a successful run. Never point it at a live customer database.

Migration 006 moves carrier settings and labels into company groups and binds new credentials to group/carrier/environment. Existing accounts receive separate groups with their original owner ID, preserving encryption context and label history. The migration runs this conversion only once; later membership changes are preserved. User deletion retains company settings and labels. Back up data/carrier-settings.key securely with the database. Current account/profile transfers omit carrier settings; re-enter them in the target deployment.

Migration 007 adds quote_logs, scoped by company group and carrier environment. Related carrier replies merge into one comparison under a row lock/serialized SQLite transaction. Creator deletion retains the log. Account/profile transfers omit rate logs; back up the complete database to retain history.
