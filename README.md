# Shipping Rate Calculator

A shipping calculator with account-owned carrier credentials, saved origin addresses, and actual API rates from Canada Post, FedEx and Loomis Express.

## Run locally with Docker

Run these commands from the repository folder with Docker Engine and Docker Compose installed. For a new setup, copy `env/local.env.example` to the ignored `env/local.env`; keep an existing file. Configure POSTGRES_PASSWORD (a random hexadecimal password), USER_EMAIL, and a quoted USER_PASSWORD of at least six characters.

```sh
docker compose --env-file env/local.env -f compose.dev.yml up -d --build
```

This starts the app in the background. Open http://localhost:3000 for production carrier APIs or http://localhost:3000/sandbox for sandbox / UAT. Sign in using the provisioned account and save carrier credentials separately in each area's **Settings** page.

Check container status and follow the web startup logs:

```sh
docker compose --env-file env/local.env -f compose.dev.yml ps
docker compose --env-file env/local.env -f compose.dev.yml logs -f web
```

Press Ctrl+C to stop following logs; the containers keep running. Stop the app and database while preserving saved data:

```sh
docker compose --env-file env/local.env -f compose.dev.yml down
```

Docker runs Node 22 and PostgreSQL, applies migrations, and creates the configured account only if it is missing. Existing passwords, roles, profiles and carrier settings are preserved. The local stack retains its existing sandbox-postgres-data volume name to preserve previously saved data. `npm run dev` runs the same local stack in the foreground; `npm run dev:stop` stops it. Use the separate hosted deployment instructions below for an optimized production build with HTTPS.

| Page | Production | Sandbox / UAT |
| --- | --- | --- |
| Entry | http://localhost:3000/ | http://localhost:3000/sandbox |
| Home | `/home` | `/sandbox/home` |
| Rates | `/rate` | `/sandbox/rate` |
| Settings | `/setting` | `/sandbox/setting` |
| Login | `/login` | `/sandbox/login` |
| API docs | `/docs` | `/sandbox/docs` |
| Admin | `/admin` | `/sandbox/admin` |

The root entry redirects to Home. Protected pages redirect signed-out or expired sessions to the corresponding Login page. Login returns you to the requested protected page. Expiry is also detected on API requests, when the tab becomes active, and with a 30-second session check.

**Both carrier environments run in the same app.** The default area uses production carrier APIs; `/sandbox` uses sandbox carrier APIs. API routes enforce this boundary and reject mismatched credential modes or quote requests. Accounts, login sessions and origin profiles are shared within one deployment; credentials and service visibility preferences stay separate by carrier environment. Production quotes require production credentials saved and enabled by that account; no sandbox credentials are reused.

## Carrier settings

Sign in and open **Settings**. Enter each carrier's API URL, API key/secret or username/password, account/customer ID, and optional contract ID. Turn Enabled on and save. These values are stored privately for your account and selected area; they are not environment settings. Only official carrier URLs are accepted. Disabled carriers are never quoted.

Saved secrets are masked. Blank secret fields preserve the existing value; new input replaces it. Clear settings clears the draft and disables the carrier in the form; click Save settings to persist it. Use **Test connection** after saving to check the saved account against the carrier API. Checks return Success, Error, Timeout or Not configured and use a small sample rate request. No label, payment or booking is created. Disabled but configured carriers can still be tested.

Carrier responses are used directly. API errors never fall back to synthetic prices. Canada Post sandbox defaults to counter/retail rates; choose commercial only with an authorized customer/contract. Loomis Canadian domestic rating supports sandbox and account-configured production SOAP 1.1 endpoints; international rating remains unsupported. FedEx sandbox can return 503/timeouts even with successful authentication. See [carrier mapping](docs/CARRIER_MAPPING.md).

Credentials are encrypted using AES-256-GCM. The server creates `data/carrier-settings.key` with owner-only permissions. Back up this key securely together with the database. Local Docker persists it in the mounted data directory; the deployment image persists it in shipping-data. Multiple replicas need the same protected key. Account/profile transfers currently omit carrier settings; re-enter those settings after transfer.

## Package measurements and copying results

Package measurements display 0 by default and can be cleared completely; blank or zero inputs use 1 in the selected units when requesting rates. Values round upward to two decimal places on blur, unit conversion and submission. Imperial (lb/in) is the default; the Metric (kg/cm) switch converts all four values together, preserving blank fields. Weight, length, width and height appear in one row on wider screens and stack in one column on screens 700px wide or smaller. Negative measurements are rejected.

Copy table exports every displayed service as a simple, aligned comparison: carrier, service, delivery, price(s) and signature. It excludes quote details, carrier status, environment labels and declared-value notes. The chosen tax setting still applies. Each result row also has Copy API result beside its status, copying the original per-service carrier values as JSON, with base and covered responses when returned. Canada Post and Loomis XML responses are represented as their parsed service objects. Authentication responses, credentials and request headers are not included.

## Deployment environment files

| File | Purpose |
| --- | --- |
| `env/local.env` | Local Docker / host runtime; ignored |
| `env/local.env.example` | Empty local deployment template |
| `env/production.env` | Hosted deployment settings; ignored |
| `env/production.env.example` | Empty hosted deployment template |

The former sandbox.env was renamed to local.env because it configures hosting, not carrier mode. Both deployments serve production and sandbox areas. APP_ENV controls HTTP/HTTPS and session-cookie policy; it does not select carrier mode. Local development supports http://localhost:3000 for both areas. Hosted production requires a real HTTPS APP_ORIGIN and Secure session cookies. Carrier mode switches, carrier credentials, and deployment-wide carrier API keys have been removed from environment templates. Root .env files are rejected to prevent accidental merging. Runtime-injected deployment settings override the selected file.

To host a built image, configure production.env with its HTTPS origin, database password and optional provisioning login, then run:

```sh
npm run dev:stop
npm run docker:production
npm run docker:production:logs
```

This starts the built app and PostgreSQL in the separate shipping-production Compose project. Both `/` and `/sandbox` remain available there. Put an HTTPS reverse proxy in front of loopback port 3000. Changing APP_ORIGIN alone does not create a domain or HTTPS endpoint. The hosted APP_ORIGIN is empty until you configure a real domain. Production deployment settings are currently incomplete, so the local app remains the active runtime.

Stop with `npm run docker:production:stop`; database and encryption-key volumes remain. Both Docker stacks publish port 3000, so only one can run at once. Their databases do not automatically transfer data.

For direct host use, Node 22.16+ and pnpm 10 are required. Configure a reachable DATABASE_URL in local.env, then run `pnpm env:check`, `pnpm db:migrate`, `pnpm user:create`, and `pnpm dev:app`. The default Docker command supplies its internal database URL automatically. Changing provisioning passwords or roles does not update existing accounts.

## Verification

```sh
pnpm typecheck
pnpm test:env
pnpm test
pnpm test:e2e
```

See [API routes](docs/API.md), [database setup](docs/DATABASE.md), and [testing](docs/TESTING.md). Secrets, database files and local verification artifacts are ignored. Carrier reference material may contain credentials or proprietary content and must remain private.

API web documentation: `/docs` for production and `/sandbox/docs` for UAT, available after login through **API docs** in the navigation. The callable JSON API uses Next.js route handlers; see [HTTP API reference](docs/API.md).

Administrators can manage accounts at `/admin` (or `/sandbox/admin`), including roles, password resets and separate Web/API access grants. Account changes revoke sessions. New accounts default to Web access enabled and API access disabled in the admin form. API login defaults to `channel: "api"`; website login sends `channel: "web"`. A web session authorizes the calculator's backend calls; an API session cannot open web pages or manage accounts. The last web-enabled admin is protected.

Bootstrap an existing administrator without changing their password after applying migrations:

```sh
docker compose --env-file env/local.env -f compose.dev.yml exec -T web node scripts/set-user-role.cjs admin@example.com admin
```

Carrier settings: **Clear settings** clears only the form and marks it unsaved. Click **Save settings** to persist the clearing. Leaving or reloading before saving retains the stored connection. Save results appear on each carrier card.

Settings connection checks show progress, status, response time and last-check time per carrier. Unsaved carrier changes trigger a leave-page prompt on app links and sign out, plus a browser warning on refresh/tab close. Back/forward cancellation is supported where the browser exposes the Navigation API. Saving all changed carrier cards removes the warning.

## Security and privacy review

Read [security guidance](SECURITY.md), [data and privacy](docs/PRIVACY.md), and the [repository review](docs/AUDIT.md) before publishing or deploying.
