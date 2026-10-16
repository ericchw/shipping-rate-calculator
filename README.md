# Shipping Rate Calculator

See the [user guide with screenshots and an animated walkthrough](docs/USER_GUIDE.md) for sign-in, carrier setup, saved origins and rate comparison.

A shipping calculator with company workspaces, shared carrier connections, personal origin addresses, saved comparisons, and sandbox labels. Compare live carrier API rates in separate Production and Sandbox/UAT areas. Supported carrier names and generic interface lists are drawn from the shared carrier registry as integrations are added.

Current integrations: Canada Post, Loomis Express, FedEx, and Purolator. Label generation currently supports Loomis Sandbox only.

## Run locally with Docker

Run these commands from the repository folder with Docker Engine and Docker Compose installed. For a new setup, copy `env/local.env.example` to the ignored `env/local.env`; keep an existing file. Configure POSTGRES_PASSWORD (a random hexadecimal password), USER_EMAIL, and a quoted USER_PASSWORD of at least six characters.

```sh
docker compose --env-file env/local.env -f compose.dev.yml up -d --build
```

This starts the app in the background. Open http://localhost:3000 for production carrier APIs or http://localhost:3000/sandbox for sandbox / UAT. Sign in using the provisioned account and use **Settings → Company groups** to manage company groups and save each group's carrier credentials separately for each environment.

Check container status and follow the web startup logs:

```sh
docker compose --env-file env/local.env -f compose.dev.yml ps
docker compose --env-file env/local.env -f compose.dev.yml logs -f web
```

Press Ctrl+C to stop following logs; the containers keep running. Stop the app and database while preserving saved data:

```sh
docker compose --env-file env/local.env -f compose.dev.yml down
```

Docker runs Node 22 and PostgreSQL, applies migrations, and creates the configured account only if it is missing. Provision an initial admin, then create users and assign their company group through **Settings → Users and access**. Existing passwords, roles, profiles and carrier settings are preserved. The local stack retains its existing sandbox-postgres-data volume name to preserve previously saved data. `npm run dev` runs the same local stack in the foreground; `npm run dev:stop` stops it. Use the separate hosted deployment instructions below for an optimized production build with HTTPS.

| Page | Production | Sandbox / UAT |
| --- | --- | --- |
| Entry | http://localhost:3000/ | http://localhost:3000/sandbox |
| Home | `/home` | `/sandbox/home` |
| Rates | `/rate` | `/sandbox/rate` |
| Labels | `/labels` | `/sandbox/labels` |
| Settings | `/setting` | `/sandbox/setting` |
| Login | `/login` | `/sandbox/login` |
| API docs | `/docs` | `/sandbox/docs` |
| Admin compatibility entry | `/admin` | `/sandbox/admin` |

The root entry redirects to Home. Protected pages redirect signed-out or expired sessions to the corresponding Login page. Login returns you to the requested protected page. Expiry is also detected on API requests, when the tab becomes active, and with a 30-second session check.

**Both carrier environments run in the same app.** The default area uses production carrier APIs; `/sandbox` uses sandbox carrier APIs. API routes enforce this boundary and reject mismatched credential modes or quote requests. Accounts, login sessions and origin profiles are shared within one deployment; credentials and service visibility preferences stay separate by carrier environment. Production quotes require production credentials saved and enabled by an admin for that company group; no sandbox credentials are reused.

## Carrier settings

An administrator opens **Settings → Company groups**, selects a company, then opens **API connections**. Enter each carrier's API URL and required credentials, enable it, and save. Connections belong to that company and carrier environment; ordinary users cannot edit or test them. Only official carrier URLs are accepted. The rate form lists only enabled carriers, and disabled carriers are never quoted.

Saved secrets are masked. Blank secret fields preserve the existing value; new input replaces it. Clear settings clears the draft and disables the carrier in the form; click Save settings to persist it. Use **Test connection** after saving to check the saved account against the carrier API. Checks return Success, Error, Timeout or Not configured and use a small sample rate request. No label, payment or booking is created. Disabled but configured carriers can still be tested.

Carrier responses are used directly. API errors never fall back to synthetic prices. Canada Post sandbox defaults to counter/retail rates; choose commercial only with an authorized customer/contract. Loomis Canadian domestic rating supports sandbox and account-configured production SOAP 1.1 endpoints; international rating remains unsupported. FedEx sandbox can return 503/timeouts even with successful authentication. See [carrier mapping](docs/CARRIER_MAPPING.md).

Credentials are encrypted using AES-256-GCM. The server creates `data/carrier-settings.key` with owner-only permissions. Back up this key securely together with the database. Local Docker persists it in the mounted data directory; the deployment image persists it in shipping-data. Multiple replicas need the same protected key. Account/profile transfers preserve company groups and memberships, but omit carrier settings and label history; re-enter connections after transfer.

## Package measurements and copying results

Boxes defaults to 1, weight to 1 lb, and length, width and height to 0 inches. Boxes and weight share a row; the three dimensions appear on the next row, including on mobile. Blank or zero weight uses 1 in the selected units for UI rate requests; the JSON API requires positive weight. All three dimensions must be positive, or all zero to omit dimensions from carrier requests. Omitted dimensions can affect the final charge. Positive measurements round upward to two decimal places. Imperial (lb/in) is the default; Metric (kg/cm) converts weight and dimensions while preserving blank fields. Negative measurements are rejected.

Weight and dimensions apply per box. Purolator supports 1–100 identical boxes and receives the combined weight. Other current adapters return unavailable for multiple boxes rather than quoting a single box. Box count is retained in rate logs and copied details.

Canadian postal-code lookup automatically fills city and province where suggestions are available; the fields remain editable. Address summaries show province, city and postal code. The map icon beside **Ship To** opens Google Maps using the current destination fields. Postal suggestions and map searches do not verify a complete delivery address.

Editing shipment details keeps the existing comparison visible. Compare again to refresh prices; label generation requires the shipment matching the quoted details.

Copy table exports every displayed service as a simple, aligned comparison: carrier, service, delivery, price(s) and signature. It excludes quote details, carrier status, environment labels and declared-value notes. The chosen tax setting still applies. **Copy request** copies the submitted calculator shipment JSON for the comparison or one carrier, using the original submitted snapshot even after editing the form. **Copy image** downloads the complete page as a JPG. Copy actions show toast feedback.

Each result row also has Copy API result beside its status, copying the original per-service carrier values as JSON, with base and covered responses when returned. Canada Post and Loomis XML responses are represented as their parsed service objects. Authentication responses, credentials and request headers are not included.

## Generated labels

An administrator must enable label generation for the company and environment; it is disabled by default. Successful live Loomis sandbox quotes can expose a compact **Generate label** action. Confirmation is required, only the selected row shows generation progress, and the generated PNG is downloaded and saved. Labels are viewed on **Labels**, rather than inserted beneath the rate table.

The label list offers 10, 20, 50 or 100 rows per page. Open a shipment row or its view link to see shipment details, preview the saved label, and download it again. Labels remain with their company when users are reassigned or deleted. This feature does not enable production label generation.

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

This starts the built app and PostgreSQL in the separate shipping-production Compose project. Both `/` and `/sandbox` remain available there. Put an HTTPS reverse proxy in front of loopback port 3000. Changing APP_ORIGIN alone does not create a domain or HTTPS endpoint. The hosted APP_ORIGIN is empty until you configure a real domain. Configure and verify the hosted environment before starting this stack.

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

Administrators manage accounts in **Settings → Users and access** (`/admin` and `/sandbox/admin` remain compatibility entries), including company assignment, roles, password resets, separate Web/API access grants, and Production/Sandbox access. Accounts are created by administrators; there is no public registration. Account changes revoke sessions. New accounts default to Web access enabled and API access disabled in the admin form. API login defaults to `channel: "api"`; website login sends `channel: "web"`. A web session authorizes the calculator's backend calls; an API session cannot open web pages or manage accounts. The last web-enabled admin is protected.

Bootstrap an existing administrator without changing their password after applying migrations:

```sh
docker compose --env-file env/local.env -f compose.dev.yml exec -T web node scripts/set-user-role.cjs admin@example.com admin
```

Carrier settings: **Clear settings** clears only the form and marks it unsaved. Click **Save settings** to persist the clearing. Leaving or reloading before saving retains the stored connection. Save results appear on each carrier card.

Settings connection checks show progress, status, response time and last-check time per carrier. Unsaved carrier changes trigger a leave-page prompt on app links and sign out, plus a browser warning on refresh/tab close. Back/forward cancellation is supported where the browser exposes the Navigation API. Saving all changed carrier cards removes the warning.

## Security and privacy review

Read [security guidance](SECURITY.md), [data and privacy](docs/PRIVACY.md), and the [repository review](docs/AUDIT.md) before publishing or deploying.

Company groups share carrier connections and label history. Only admin web sessions can create accounts, assign groups, or edit/test API settings. Users and operators require a group; admins may remain unassigned for management only. Saved origin addresses remain personal. Tracking/label generation is disabled by default per group and carrier environment; current generation supports Loomis sandbox only. Deleting a user preserves their company's labels and connections. Changing group assignment revokes the user's sessions and leaves past labels with the original company.

Migration 006 preserves each existing account in its own group, initially named with its email, retaining encrypted credentials, labels and the previous generation permission. Administrators can rename these groups and assign accounts to a shared company. Assignment uses the destination company's existing connections; it does not merge or move another group's labels or credentials.

Every valid rate comparison is saved in company **Rate logs**, available in a dialog on the Rates page. View historical prices and carrier statuses, then load shipment details to compare current rates. Past ship dates are changed to today; disabled carriers and personal profile ownership are respected. Individual logs can be deleted with confirmation; deletion removes the comparison for the whole company without deleting shipping labels. Raw carrier response blobs are not saved. Company rate logs survive creator deletion and are omitted from account/profile transfers.

## Purolator rates

In **Settings → Company groups → API connections**, configure Purolator independently in Sandbox/UAT and Production. Enter a REST client ID and client secret/password; legacy SOAP keys are not interchangeable. Production also requires an `x-api-key`. For UAT apps without an issued API key, the application permits it to remain blank and omits that header; Purolator determines whether the request is accepted. Fields follow the issued credential order: Client ID, Client Secret, Key (`x-api-key`), Sender Account, Receiver Account, and Freight Account. Enter the sender billing account, and optionally store receiver and freight accounts. Courier comparisons are billed to the sender; receiver billing and freight quoting are not implemented. Purolator starts disabled and appears in rate options only after an administrator enables it.

The adapter uses the official [Estimate API](https://ship.purolator.com/developer/restapicatalogue/estimate) and [Authentication API](https://ship.purolator.com/developer/restapicatalogue/authentication). It requests alternative eligible services and displays returned CAD totals, taxes and delivery estimates. Zero dimensions are omitted. Sender origins are currently limited to Canada by the published courier request schema. Sandbox and production credentials and tokens remain separate.

SQLite and PostgreSQL migration 009 add Purolator to saved carrier settings while preserving existing encrypted credentials.

## Language and appearance

The header separates workspace controls from page navigation. Its upper row groups Production/Sandbox selection, language, an icon-only theme button, and sign out; the page links sit below with an underline for the active page. Environment choices respect account access. On mobile, sign out uses an accessible icon and page navigation can scroll horizontally. A full-width banner marks Sandbox pages.

Languages are English (EN), French (FR), Traditional Chinese (ZH-TW), and Simplified Chinese (ZH-CN). Theme defaults to the system preference. The icon button cycles System → Dark → Light → System without a menu. Dropdown options use theme-aware foreground and background colors. Preferences apply to both carrier environments, are saved in browser storage, and synchronize between tabs. Switching language keeps shipment inputs and existing comparisons. Theme selection follows system changes when System is selected and is applied before the page paints.

Interface translations live in `src/lib/translations.json`, with English source text as keys and French, Traditional Chinese, and Simplified Chinese entries. Unknown carrier messages retain their original wording. Carrier names, customer addresses, credential values, API fields, and copied request/response JSON are preserved. Date/time region remains independently configurable in Settings.
