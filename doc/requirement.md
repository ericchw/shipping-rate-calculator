# Shipping Rate Calculator — Codex Implementation Specification

> **Role:** You are Codex, acting as a senior full-stack engineer. Build a working, documented repository from this specification. Implement features, tests, Docker support, and example configuration. Do not stop after generating scaffolding. Do not invent carrier API fields, prices, or transit commitments.

## 1. Objective

Create a responsive web application and secured HTTP API for comparing **Canada Post**, **Loomis Express**, and **FedEx** shipping rates. A user enters origin/destination, parcel dimensions, weight, optional signature and declared value/coverage; the app requests available services and displays their **quoted price** and **delivery time** when available. If coverage is entered, show comparable **without coverage** and **with coverage** quotes per service, as well as the difference. Rates must come from real carrier integrations, not client-side price formulas.

Project name: `shipping-rate-calculator`. Default currency: **CAD**. Default origin/destination country: **Canada**, but design the schema to support international shipping where carrier accounts and API capabilities allow it. Date/time zone: `America/Vancouver` for UI defaults; store timestamps as ISO UTC. This is a **rate comparison tool only** in v1: do not buy labels, create shipments, arrange pickups, or charge payments.

## 2. Required Stack

- **Monorepo:** `pnpm` workspaces, TypeScript strict mode.
- **Web frontend:** Next.js App Router, React, Tailwind CSS, accessible UI components. Mobile-friendly, responsive desktop-first comparison table.
- **Backend API:** Next.js Route Handlers for v1 (`/api/v1/...`), explicitly server-only carrier integration modules. Extract into a separate service later without changing the API contract.
- **Validation:** Zod with shared schemas/types.
- **Carrier transport:** Node.js `fetch` for REST, a maintained SOAP client or safe XML/SOAP implementation for Loomis; hardened XML parser with no external entities (XXE disabled).
- **Money:** decimal-safe arithmetic (`decimal.js` or integer minor units), never floating-point summation for money.
- **Tests:** Vitest unit/integration tests, MSW or fixtures for carrier mocks, Playwright basic UI e2e.
- **Deployment:** Dockerfile multi-stage, `compose.yml`, `compose.dev.yml` or equivalent, `env/sandbox.env.example` (development/sandbox only), `env/production.env.example` (production/live only); production secrets injected at runtime. Keep actual local settings in ignored `env/sandbox.env`. Select SQLite/PostgreSQL inside these settings rather than creating separate database-specific env files.
- **Persistence:** required for authenticated users, sessions, and saved origin profiles (section 15). Set up PostgreSQL as the primary deployment option; retain SQLite as a selectable local alternative. Both must have equivalent migrations and ownership constraints. Select the backend using `DATABASE_PROVIDER=sqlite|postgresql` and `DATABASE_URL`, then restart the server. Keep database files, backups, credentials, and local environment files out of this public repository. Quote addresses and carrier responses are not persisted.

## 3. Repository Layout

```text
shipping-rate-calculator/
├── AGENTS.md                     # Codex execution and safety instructions
├── README.md                     # installation, credentials, development, deployment
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── CARRIER_MAPPING.md
│   └── TESTING.md
├── doc/
│   └── loomis/                  # EXISTING carrier reference documents; inspect, preserve
├── src/
│   ├── app/
│   │   ├── page.tsx
│   │   └── api/v1/
│   │       ├── rates/route.ts
│   │       ├── carriers/route.ts
│   │       └── health/route.ts
│   ├── components/
│   │   ├── ShippingForm.tsx
│   │   ├── AddressFields.tsx
│   │   ├── PackageFields.tsx
│   │   ├── RateResults.tsx
│   │   └── CoverageComparison.tsx
│   ├── lib/
│   │   ├── carriers/
│   │   │   ├── types.ts
│   │   │   ├── canada-post.ts
│   │   │   ├── loomis.ts
│   │   │   └── fedex.ts
│   │   ├── quote-service.ts
│   │   ├── config.ts
│   │   ├── units.ts
│   │   ├── money.ts
│   │   ├── postal-code.ts
│   │   ├── schemas.ts
│   │   └── errors.ts
│   └── styles/
├── tests/
│   ├── fixtures/               # sanitized carrier response fixtures
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── env/sandbox.env.example
├── env/production.env.example
├── .gitignore
├── Dockerfile
├── compose.yml
├── compose.dev.yml
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

Codex may refine the folder layout, but preserve explicit modular carrier adapters and public API separation. **Inspect `./doc/loomis` first** and record what those documents establish; if files are absent, implement an adapter stub/clear diagnostic and document which Loomis protocol details are blocked. Never delete or overwrite user-provided Loomis reference documents.

## 4. Credentials and Environment Management

**Never place carrier credentials in browser code or `NEXT_PUBLIC_*`. Never commit local `.env` files with real values.** The application must support **two independent carrier configurations per carrier**: `sandbox` (UAT) and `production` (live). Each carrier has distinct URLs and credentials; never silently reuse sandbox details in production or vice versa. `env/sandbox.env.example` and `env/production.env.example` contain empty secret fields only. Use `env/sandbox.env` for local development and secret-manager/runtime injected variables for production.

**There are two separate concepts:**

1. `APP_ENV=development|uat|production` is the **deployment/application environment**.
2. `CARRIER_MODE=sandbox|production` is the **carrier API environment** used for one rate comparison. Do not assume `NODE_ENV=production` means carrier production: a deployed UAT web app may use a production-built Next.js server while calling only carrier sandbox endpoints.

Create typed server-side configuration for each carrier, and require **explicit mode routing**. Include the following keys across the sandbox and production templates, keeping each carrier mode in its own file (values below are templates; endpoints must be verified against current official documentation before use):

```dotenv
NODE_ENV=development
APP_ENV=development
DEFAULT_CARRIER_MODE=sandbox
ENABLE_SANDBOX_MODE=true
ENABLE_PRODUCTION_MODE=false
ALLOW_PRODUCTION_CARRIER_CALLS=false
# An actual production deployment may enable live mode only after admin configuration.
PORT=3000
APP_API_KEY=
# The UI MUST NOT receive APP_API_KEY or any carrier credential.

# Canada Post: HTTP Basic developer API username/key + password/secret
CANADA_POST_ENABLED=true
CANADA_POST_SANDBOX_BASE_URL=https://ct.soa-gw.canadapost.ca
CANADA_POST_SANDBOX_API_KEY=
CANADA_POST_SANDBOX_API_SECRET=
CANADA_POST_SANDBOX_CUSTOMER_NUMBER=
CANADA_POST_SANDBOX_CONTRACT_ID=
CANADA_POST_PRODUCTION_BASE_URL=https://soa-gw.canadapost.ca
CANADA_POST_PRODUCTION_API_KEY=
CANADA_POST_PRODUCTION_API_SECRET=
CANADA_POST_PRODUCTION_CUSTOMER_NUMBER=
CANADA_POST_PRODUCTION_CONTRACT_ID=

# Loomis Express: SOAP/WSDL URL + username/password; account if needed by the WSDL
LOOMIS_ENABLED=true
LOOMIS_SANDBOX_USERNAME=
LOOMIS_SANDBOX_PASSWORD=
LOOMIS_SANDBOX_ACCOUNT_NUMBER=
LOOMIS_SANDBOX_RATING_WSDL_URL=https://sandbox.loomis-express.com/axis2/services/USSRatingService?wsdl
LOOMIS_SANDBOX_BUSINESS_WSDL_URL=https://sandbox.loomis-express.com/axis2/services/USSBusinessService?wsdl
LOOMIS_SANDBOX_ADDONS_WSDL_URL=https://sandbox.loomis-express.com/axis2/services/USSAddonsService?wsdl
LOOMIS_PRODUCTION_USERNAME=
LOOMIS_PRODUCTION_PASSWORD=
LOOMIS_PRODUCTION_ACCOUNT_NUMBER=
LOOMIS_PRODUCTION_RATING_WSDL_URL=
LOOMIS_PRODUCTION_BUSINESS_WSDL_URL=
LOOMIS_PRODUCTION_ADDONS_WSDL_URL=

# FedEx: OAuth API key/client ID + secret, shipping account number, API URL
FEDEX_ENABLED=true
FEDEX_SANDBOX_BASE_URL=https://apis-sandbox.fedex.com
FEDEX_SANDBOX_CLIENT_ID=
FEDEX_SANDBOX_CLIENT_SECRET=
FEDEX_SANDBOX_ACCOUNT_NUMBER=
FEDEX_PRODUCTION_BASE_URL=https://apis.fedex.com
FEDEX_PRODUCTION_CLIENT_ID=
FEDEX_PRODUCTION_CLIENT_SECRET=
FEDEX_PRODUCTION_ACCOUNT_NUMBER=

# Fixture mode, always visibly labeled; independent of carrier sandbox UAT
MOCK_CARRIERS=false
```

**Carrier credential models:**

- **Canada Post:** API Key / API Secret (often represented by an API username and password for HTTP Basic authentication), API base URL, and account/customer or contract details if required for the rating operation. Codex must verify endpoint and authorization format with current Canada Post documentation.
- **Loomis:** `username`, `password`, sandbox/production WSDL/service URLs, and an **optional account number if required** by local SOAP documentation. WSDL location is not necessarily the actual HTTP POST service address: extract and validate the SOAP address from WSDL, and allow a separately configured SOAP endpoint when the documentation demands it. The provided sandbox test username/password must be entered only in an ignored local secret file, not embedded in tracked examples.
- **FedEx:** OAuth client ID (API key), client secret (API secret), account number, and base URL for **each mode**. Obtain an OAuth token against the matching environment; use that mode's account in rating requests. Do not assume an OAuth token or account number can be used across modes.

**Mode isolation and credential safety:**

- At startup, validate both mode schemas without requiring missing credentials for a **disabled** mode. Enabled mode + carrier still may be `unconfigured`, but must be shown clearly. In `APP_ENV=uat`, **disallow production mode entirely** irrespective of client requests.
- Default to `sandbox`. Selecting `production` requires `ENABLE_PRODUCTION_MODE=true`, `ALLOW_PRODUCTION_CARRIER_CALLS=true`, and an authorized admin/operator; fail closed if any condition is false. In `APP_ENV=production`, production may be the default only if explicitly enabled.
- Configure endpoints by an immutable server-side allowlist per carrier and mode. Never accept raw URLs, tokens, account numbers or secrets from the browser request. A mode selector is **not** permission to access live systems.
- FedEx token caching must be keyed by **mode + client ID/account identity**, with early expiry; never send a sandbox token to production or vice versa.
- Include carrier, mode, and `source` (`live_carrier` or `mock`) in each status/result. Hide credential values in diagnostics; health/status may only report `configured`, `disabled`, or `unconfigured`.
- When a carrier is unconfigured for selected mode, report it as unconfigured rather than falling back to credentials or URLs from the other mode.
- Require separate UAT smoke tests and live-mode opt-in smoke tests; never hit real production endpoints in CI by default.

**Authentication for our own API:** Protect `/api/v1/rates` with `Authorization: Bearer <APP_API_KEY>` for **server-to-server callers**. The browser UI must not receive or store that key. Give the UI a secure server session, or a same-origin protected backend-for-frontend route that injects the internal credential server-side; enforce CSRF/origin checks, request size limits, and rate limiting. In production require login or other suitable controlled access instead of exposing unrestricted public carrier quoting. `/api/v1/health` exposes no secrets. Consider per-user/IP rate limits and audit logs without PII.

## 5. Carrier Integration — Sources and Acceptance Rules

### 5.1 Canada Post

- Official rating documentation: https://www.canadapost-postescanada.ca/info/mc/business/productsservices/developers/services/rating/default.jsf
- Use **Get Rates** to list services, prices and delivery estimates. Inspect REST documentation first: https://www.canadapost-postescanada.ca/info/mc/business/productsservices/developers/services/rating/getrates/default.jsf
- Also inspect **Discover Services**, **Get Service**, and **Get Option** to identify service availability, signature options, declared value/coverage rules, dependency/conflict constraints.
- Build compliant request XML, authentication headers, environment-specific base URLs, and parse responses safely. Check the actual published API requirements and product versions.
- For an optional signature, map to the appropriate official service option **only when supported** by the selected service/contract; do not make up option codes.
- For coverage, request the carrier's supported declared-value/coverage feature and return separately rated scenarios where valid. A declared value input is not proof of actual insurance coverage; present carrier wording and exclusions clearly.
- Capture carrier-provided taxes, option charges, service codes, expected delivery dates/estimates, and quote totals where returned.

### 5.2 Loomis Express

- **Priority: read every relevant file in `./doc/loomis` before coding this adapter**. Inspect WSDL schemas, sample requests/responses, test requirements, credentials, account fields, available service codes, signature, declared value/coverage, time estimates, currency, and error codes.
- User-provided sandbox URLs:
  - Rating: `https://sandbox.loomis-express.com/axis2/services/USSRatingService?wsdl`
  - Business: `https://sandbox.loomis-express.com/axis2/services/USSBusinessService?wsdl`
  - Addons: `https://sandbox.loomis-express.com/axis2/services/USSAddonsService?wsdl`
- Use **USSRatingService** for rates. Use Business/Addons services only for real documented capabilities required for rate computation/options; do not assume they provide delivery time.
- Preserve SOAP namespace, request element names, auth mechanism and account number exactly as documented. Configure timeouts and normalize SOAP faults; redact sensitive data from errors.
- If Loomis WSDL/documentation lacks a transit estimate or supported coverage option, return `null`/`unavailable` rather than guessing and annotate the result.

### 5.3 FedEx

- Official developer catalog: https://developer.fedex.com/wirc/browser/en-ca/catalog/rate
- Rate and Transit Times docs: https://developer.fedex.com/api/en-us/catalog/rate/docs.html (verify current canonical URL and API version within developer portal).
- Use server-side OAuth token acquisition, environment-specific API base URLs, and authorized account number; build rate requests for **all applicable package services**, not a single hard-coded service.
- Request transit times/commitment dates when supported. Include accurate shipment date, packaging, weight, dimensions, signature options and **declared value** if supported. Obtain account-specific rates when configured; distinguish published/list rates if supplied.
- FedEx may require specific account enrollment, permission, or packaging eligibility to return some services. Report unavailable services accurately, not as zero-price quotes.
- A detailed **Comprehensive Rate and Transit Times** API may be available depending on the account and integration; use a supported API that can produce all applicable quotes. Verify API-specific field names rather than guessing.

### 5.4 Consistent Rules for All Carrier Adapters

Each carrier implements:

```ts
interface CarrierAdapter {
  carrier: 'canada_post' | 'loomis' | 'fedex';
  isConfigured(): boolean;
  getRates(request: NormalizedShipment, options: { coverage: boolean }): Promise<CarrierResult>;
}
```

The orchestrator calls configured/enabled adapters **concurrently**, applies per-carrier timeouts (e.g. 12 seconds, configurable), and returns partial results if one carrier fails. Do not silently omit failures. Implement bounded retries with exponential backoff for transient errors and 429/5xx responses, never blindly repeat a potentially billable or non-idempotent action (rate quoting only in v1). Do not generate shipping rates from static tables. Include `source: 'live_carrier' | 'mock'` in responses and clearly distinguish mock mode.

## 6. Form and User Experience

Build a clean, fast responsive rate comparison page with the following controls.

**Shipment origin and destination**

- Origin: country (default CA), postal/ZIP code, province/state, city; street address and unit optional unless a carrier requires them.
- Destination: country (default CA), postal/ZIP code, province/state, city; street address and unit optional unless a carrier requires them.
- Validate and normalize Canadian postal codes (accept `V6B 1A1` and `V6B1A1`), preserve initial zeros in US ZIP codes, and adapt required fields to destination country.
- Ship date (default next valid business day in America/Vancouver, but allow user to choose); optional pickup/drop-off type if needed by carrier.

**Parcel**

- Length, width, height: positive decimal inputs, selectable **cm/in**; synchronize values on unit switch without silently changing the physical size.
- Weight: positive decimal input, selectable **kg/lb**; synchronize values on unit switch.
- Prefer canonical internal units `cm` and `kg`; 1 in = **2.54 cm**, 1 lb = **0.45359237 kg**. Keep precision until the carrier boundary and round only as required by each carrier's documented API.
- Default one parcel, but model `packages[]` for later multi-package support; v1 should clearly show single-package limitation.
- Display optional calculated volumetric size information, but never use a made-up dimensional divisor to override quoted weight or rate. Apply carrier-specific rules only if verified.

**Add-ons**

- `Signature required`: Yes/No toggle, default No.
- `Coverage/declared value`: optional CAD amount. Blank or 0 means no coverage requested. When positive, show **both** without-coverage and with-coverage results for each compatible carrier service. Coverage amount is passed as the declared value where supported; do not assert guaranteed coverage.
- If signature is enabled, apply signature to **both** quote scenarios, keeping coverage as the only differing variable. Clearly identify signature-related charges if returned.
- For carrier services without coverage availability, show base quote and `Coverage not available` instead of assuming a coverage surcharge.

**Carrier API mode / UAT checkout**

- Show a clearly labeled **Sandbox / UAT** versus **Production / Live** selector at the top of the shipping form (checkbox or segmented control). Default to **Sandbox / UAT** where enabled.
- This is a carrier **rate checkout/test mode**, not a payment checkout: do not charge cards, purchase labels or book shipments. The result view must show a persistent `SANDBOX / UAT — TEST QUOTES` indicator in sandbox and an explicit `PRODUCTION — LIVE API` indicator in live mode.
- Only show or enable production selection for authenticated users with operator/admin permission and enabled server configuration. Non-admin users cannot override mode through API request bodies or query parameters.
- Changing mode clears prior quotes and runs a new comparison using **only** that mode's URLs, credentials, and carrier accounts. Never mix sandbox carrier quotes with production quotes in one comparison.
- For public users, force the server's configured allowed mode instead of exposing a privileged mode switch. Include an intentional confirmation on entering production mode to avoid accidental live traffic.

**Results**

- One row per **carrier + service + meaningful packaging/rate variant**. Columns: Carrier, Service, ETA / Estimated Delivery Date, Base Rate (without declared-value coverage), Rate With Coverage, Coverage Difference, Signature, Currency, Status.
- When no coverage amount is entered, show a single Rate column instead of an empty coverage comparison.
- Amounts must distinguish tax-inclusive vs tax-exclusive where carrier reports it; prefer comparable payable totals in **CAD**, and identify currencies that cannot be converted without verified exchange data. Do not pretend different currencies are directly comparable.
- Sorting: lowest price, fastest estimate, carrier. Filtering: carrier checkboxes, signature availability, show errors/unavailable.
- Show cheapest available and fastest available option, but only if comparable price and ETA data are present.
- ETA display distinguishes guaranteed delivery commitment, estimated delivery, transit-days-only, and unavailable; never fabricate calendar dates from transit days without a documented calculation.
- Loading indicators per carrier; partial responses/errors rendered accessibly. Display last updated quote time and caveat **“Carrier quotes are estimates; final charges and coverage terms may differ.”**
- A prominent `Compare rates` button and `Reset` action. Prevent duplicate submissions; keyboard and screen-reader accessible.

## 7. Shared API Contract

`POST /api/v1/rates` (requires protected API authentication for external requests; server authorizes the requested `carrierMode` against the caller role and deployment policy)

Example request:

```json
{
  "origin": { "countryCode": "CA", "postalCode": "V6B 1A1", "provinceCode": "BC", "city": "Vancouver" },
  "destination": { "countryCode": "CA", "postalCode": "M5V 2T6", "provinceCode": "ON", "city": "Toronto" },
  "shipDate": "2026-10-13",
  "packages": [{ "length": 30, "width": 20, "height": 15, "dimensionUnit": "cm", "weight": 2.5, "weightUnit": "kg" }],
  "signatureRequired": true,
  "coverageAmount": 500,
  "coverageCurrency": "CAD",
  "carriers": ["canada_post", "loomis", "fedex"],
  "carrierMode": "sandbox"
}
```

Example shape (**illustrative structure, not real prices**):

```json
{
  "requestId": "uuid",
  "quotedAt": "2026-10-09T20:00:00.000Z",
  "mode": "sandbox",
  "appEnvironment": "uat",
  "results": [
    {
      "carrier": "canada_post",
      "serviceCode": "CARRIER_SERVICE_CODE",
      "serviceName": "Carrier service name",
      "currency": "CAD",
      "eta": { "kind": "estimated_date", "date": "2026-10-16", "businessDays": null },
      "signature": { "requested": true, "available": true, "includedInQuote": true },
      "withoutCoverage": { "available": true, "total": "25.00", "taxIncluded": true, "breakdown": [] },
      "withCoverage": { "available": true, "total": "29.00", "taxIncluded": true, "breakdown": [], "declaredValue": "500.00" },
      "coverageDifference": "4.00",
      "source": "mock",
      "notices": []
    }
  ],
  "carrierStatuses": [
    { "carrier": "canada_post", "status": "success", "message": null },
    { "carrier": "loomis", "status": "unconfigured", "message": "Credentials missing" },
    { "carrier": "fedex", "status": "error", "message": "Carrier rate API temporarily unavailable" }
  ]
}
```

**Important:** All sample prices and dates above are synthetic contract fixtures, never represented as live. `coverageDifference` is `withCoverage.total - withoutCoverage.total` **only** when the same service/variant, currency, tax basis, signature settings, and other options are comparable. Otherwise `null` with explanatory notice. For disabled/unsupported add-ons use explicit statuses: `not_supported`, `not_quoted`, `carrier_error`; do not display zero as a missing price.

Other routes:

- `GET /api/v1/carriers`: enabled/configured/available statuses only; do **not** return secrets.
- `GET /api/v1/health`: liveness check; no carrier credentials or other sensitive operational details.
- Reject attempts to switch to `production` from an unauthorized session with `403 MODE_NOT_ALLOWED`; never fall back to another environment.
- Standard error response: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [] }, "requestId": "..." }`.
- Ensure all responses use appropriate 400/401/403/429/500 status, and support **partial carrier failures** without losing successful quotes.
- Provide an OpenAPI 3 schema or `docs/API.md` with complete request/response structures.

## 8. Coverage Quote Comparison Algorithm

1. Validate and normalize request; compute exact unit conversions using decimal-safe arithmetic.
2. For each configured carrier, request a base quote **without coverage** but with all other selected options (e.g. signature).
3. When `coverageAmount > 0`, request a second quote **with the declared value/coverage option** if allowed; optimize requests only where a carrier officially returns both variants in one request.
4. Match quotes by canonical carrier service code, package/variant, shipment parameters, and chosen tax basis. If the carrier changes service eligibility, retain the base row and show the covered variant as unsupported/unavailable; do not incorrectly subtract unrelated services.
5. Extract exact carrier totals, option charges, taxes, and dates. Calculate differences only for valid matched comparable quotes.
6. Merge all carriers' successful responses; attach per-carrier errors and render partial results.
7. If coverage is unsupported, the request is declined, or the declared value exceeds a service's limit, provide an informative service-level status and no fabricated covered rate.
8. Do not equate **declared value** with full third-party shipment insurance; include carrier-specific coverage terms in the UI when available.

## 9. Input Validation and Security

- Server-side Zod validation for positive finite weight/dimensions, sensible configurable maxima, valid dates, postal codes, supported country/currency combinations, coverage >= 0, and max one package for v1.
- Reject unknown/unsupported enum values and unreasonable payload sizes. Never trust UI validation alone.
- Keep passwords, tokens and account numbers server-side; redact `Authorization`, SOAP credentials, API secrets, customer/account numbers and address PII from logs and error responses.
- No SSRF: carrier URLs must come from an allowlisted server configuration, never from user inputs; validate HTTPS for production.
- Harden XML processing against XXE/DTD and entity expansion; prevent SOAP header injection and XML escaping bugs.
- Use Node server runtime (not Edge) for carrier SOAP/credentials; server-only imports guard integration code.
- Apply API auth, authorization, request throttling, CORS/same-origin policy, CSRF protections for browser session requests, and safe production error handling.
- Do not store personal shipment addresses or quotes persistently by default; document logging and retention.
- Keep any FedEx OAuth token caching in the backend; no browser-accessible secrets.

## 10. Development, Mocking and Tests

- `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` should work, with scripts created and documented.
- Provide `MOCK_CARRIERS=true` **development/test only** to run the UI without live credentials, using clearly labeled deterministic fixtures. Refuse mock mode in production unless explicitly enabled for an isolated demo with unmistakable branding.
- Unit tests: cm/in, kg/lb round trips, precision, postal-code normalization, Zod invalid cases, coverage difference math, service matching, currency/tax mismatch behavior.
- Adapter tests: sanitized recorded fixtures; successful rate listing, signature and declared-value option, unsupported option, SOAP fault, HTTP 401/429/5xx, malformed XML, OAuth refresh, missing ETA.
- API tests: authentication, validation, all-success, one-carrier-failure, all-carriers-failure, timeout, missing config, no secrets in output; sandbox/production URL and credential isolation; forbidden mode override; missing-mode credentials do not fall back.
- E2E: form inputs, unit toggle, signature toggle, coverage comparison, carrier filters, sorting, accessible errors, responsive screen; UAT/live mode labels, gated selector and clearing stale results on mode change.
- Sandbox smoke tests must be **opt-in** (`pnpm test:live:sandbox`) and skip clearly if credentials missing. Never hit production during CI.

## 11. Docker and Deployment

- Production Docker image runs as non-root and is built with pinned package versions and a lockfile.
- Development Compose supports source mounts/hot reload and secret-free defaults.
- Production Compose uses runtime `.env` injection from the host or secret manager; no credentials baked into images.
- Document local startup (`cp env/sandbox.env.example env/sandbox.env`, configure credentials, `pnpm dev`) and Docker startup, including distinct UAT and production URL/key/secret/account variables in their respective templates for all carriers, sandbox validation and the production safety switch.
- Ensure frontend cannot read server environment variables. Document reverse proxy HTTPS, health checks, logging, deploy rollback, and how to rotate keys.
- Provide `env/production.env.example` using **placeholders**, not copied sandbox user credentials or live tokens.

## 12. Mandatory Codex Work Plan

Execute in sequence; make working code and commit logically if the repository is git-initialized:

1. Inspect repository state and all existing `./doc/loomis` material. Summarize the SOAP operations and exact fields in `docs/CARRIER_MAPPING.md` with source filenames; note any gaps.
2. Verify Canada Post and FedEx documentation, including authentication, **both sandbox and production endpoints**, rating operation versions, signature and declared-value fields. Record confirmed details and URLs. Do not invent missing details.
3. Scaffold Next.js TypeScript app, styling, schemas, typed carrier interface, **separate mode-specific credentials and endpoints**, environment validation, API authentication, and mock fixture mode.
4. Build form, conversion utilities, responsive comparison table, option controls, partial-error UX, and sorting/filtering.
5. Implement Canada Post adapter with contract-tested request/response normalization.
6. Implement FedEx OAuth + rate adapter, all applicable services and transit details.
7. Implement Loomis SOAP adapter strictly from local docs/WSDL. If documents or WSDL are inaccessible, leave a compile-safe, clearly labeled unconfigured adapter and document exact missing contract data instead of fabricating calls.
8. Implement two-scenario comparison and canonical service matching.
9. Add tests, OpenAPI/docs, Docker configs, `.env` templates and README.
10. Execute lint, typecheck, tests, build, and dev smoke test; fix failures. Report test outcomes, unverified live integrations and any external credentials required.

## 13. Definition of Done

- [ ] `pnpm dev` shows a polished rate comparison UI with functional mock mode.
- [ ] Can enter Canadian origin/destination and validate postal codes.
- [ ] cm ↔ in and kg ↔ lb switch without changing physical measurements.
- [ ] Signature and optional coverage are supported and normalized correctly.
- [ ] Without coverage vs with coverage is visible side-by-side per matching carrier service when a coverage amount is entered.
- [ ] Quote rows show carrier, service, amount, and ETA when the API provides it.
- [ ] All three carriers are represented by modular adapters; each uses real API contracts once credentials/docs are available.
- [ ] Failed carriers do not hide successful results; status clearly explains issues.
- [ ] No live secrets committed or exposed in browser bundles/network responses.
- [ ] API secured for server-side clients; browser UI uses safe server-side access.
- [ ] Automated tests and production build pass.
- [ ] UAT sandbox checkout/rating mode uses **only sandbox URLs, keys/secrets, usernames/passwords and accounts**; production uses a completely separate set.
- [ ] Mode selector is permission-gated, server-validated, and cannot leak or cross-wire credentials.
- [ ] README fully documents sandbox vs production setup and real-vs-mock limitations.

## 14. Carrier Documentation Links

1. Canada Post Rating: https://www.canadapost-postescanada.ca/info/mc/business/productsservices/developers/services/rating/default.jsf
2. Canada Post Get Rates REST: https://www.canadapost-postescanada.ca/info/mc/business/productsservices/developers/services/rating/getrates/default.jsf
3. Loomis local reference: `./doc/loomis` (authoritative for this integration; inspect in repo)
4. Loomis sandbox rating WSDL: https://sandbox.loomis-express.com/axis2/services/USSRatingService?wsdl
5. Loomis sandbox business WSDL: https://sandbox.loomis-express.com/axis2/services/USSBusinessService?wsdl
6. Loomis sandbox addons WSDL: https://sandbox.loomis-express.com/axis2/services/USSAddonsService?wsdl
7. FedEx Rate API: https://developer.fedex.com/wirc/browser/en-ca/catalog/rate
8. FedEx Rate and Transit Times docs: https://developer.fedex.com/api/en-us/catalog/rate/docs.html

**Final instruction to Codex:** Implement the repository, not just a plan. Favor accurate carrier-specific behavior and explicit unsupported statuses over speculative integrations. The developer running Codex will supply credentials in local environment files; do not request that credentials be pasted into source files or chat logs.

## 15. Ship From / Ship To and Saved Origin Profiles (Required)

### 15.1 Quote form
- Display distinct **Ship From** (origin) and **Ship To** (destination) sections; do not infer origin from destination or browser location.
- Both sections support: contact/company name (optional where carrier permits), address line 1, address line 2, city, province/state, postal/ZIP code, country (default CA), and optional phone/email when needed by a carrier. Validate required fields and country-specific postal codes.
- Provide a **Saved Ship From Profile** dropdown above origin fields, with `New address` and `Manage profiles` options. Selecting a profile populates origin fields, which can then be edited for a one-off quote without changing the saved record.
- Provide **Save as profile** and **Update profile** actions, with explicit confirmation before overwriting. Allow user-defined profile names, e.g. `Vancouver Warehouse`, `Richmond Store`, `Returns Department`.
- Allow setting one default origin profile per user; load it on new quotes. Ship To remains independently editable and is not automatically saved as an origin profile.
- Quote results and API requests must use the currently displayed origin/destination values, not stale saved-profile values.

### 15.2 Persistence and ownership
- Implement persistent storage with PostgreSQL as the primary setup and SQLite available through server configuration. Supply migrations for both, test equivalent constraints, and document switching providers and transferring existing data; switching a URL does not transfer records. Database provider selection is a deployment setting, not a public browser control.
- Add `ship_from_profiles` table: `id` UUID, `user_id` foreign key, `profile_name`, `contact_name`, `company`, `address_line1`, `address_line2`, `city`, `region`, `postal_code`, `country_code`, `phone`, `email`, `is_default`, `created_at`, `updated_at`.
- Profile names must be non-empty and unique per user (case-insensitive); multiple users may use the same name. Enforce at most one default per user transactionally.
- Profiles belong to the authenticated user; require authentication and server-side authorization on all profile reads/writes. Do not trust client-supplied `user_id`. If authentication is not implemented yet, add it before enabling shared persistent profiles; do not expose a global shared address book.
- Support create, list, get, update, delete, and set-default. Confirm deletion and handle deletion of the default profile gracefully.
- Treat address/contact information as personal data: restrict access, avoid logging full addresses unnecessarily, and document retention/deletion.

### 15.3 REST API
- `GET /api/v1/ship-from-profiles` — current user's profiles
- `POST /api/v1/ship-from-profiles` — create named profile
- `GET /api/v1/ship-from-profiles/{id}` — retrieve owned profile
- `PATCH /api/v1/ship-from-profiles/{id}` — rename or edit
- `DELETE /api/v1/ship-from-profiles/{id}` — delete
- `PUT /api/v1/ship-from-profiles/{id}/default` — set default
- Quote request schema includes independent `ship_from` and `ship_to` address objects and optional `ship_from_profile_id` for audit/reference. If both profile ID and explicit address are sent, use explicit address for the quote; reject unauthorized profile IDs.
- Validate input with typed schemas; return clear 400/401/403/404/409 errors. API tokens for rate integrations are not substitutes for end-user identity.

### 15.4 UI behavior and acceptance tests
- Show loading, empty, error, and success states for profile management; support keyboard-accessible selection and forms.
- Verify that creating `Vancouver Warehouse`, setting it as default, reloading the page, and starting a new quote populates Ship From correctly.
- Verify Ship To can be changed without affecting Ship From.
- Verify editing origin fields for a single quote does not mutate the saved profile unless `Update profile` is explicitly chosen.
- Verify user A cannot view, update, delete, or quote using user B's profile ID.
- Verify saved profiles work identically in sandbox and production carrier modes; the mode changes credentials/endpoints, not the user's address book.
