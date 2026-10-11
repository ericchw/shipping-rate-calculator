# HTTP API v1

Web documentation is available after login at `/docs` (production) and `/sandbox/docs` (sandbox / UAT), linked as **API docs** in the navigation. The server uses Next.js route handlers, not Python FastAPI. Call production endpoints under `/api/v1` and sandbox endpoints under `/sandbox/api/v1`; the requested mode must match that area.

All responses use `Cache-Control: no-store`. JSON request bodies are limited to 16 KiB. Unknown fields are rejected. Errors contain `{error:{code,message,details:[]},requestId}`; validation details identify paths/messages. Codes include 400 validation, 401 login/session failure, 403 Origin/mode/ownership policy, 404 missing owned profile, 409 name conflict, 413 size, 429 throttling, and 500 safe internal failure. Unauthorized profile IDs return 404 to avoid disclosure.

## Authentication

The application API currently uses account session cookies, not OAuth or JWT bearer tokens. Sessions last eight hours and logout revokes them. FedEx OAuth is used only for upstream carrier requests and cannot authenticate callers of this API.

POST `/api/v1/auth/login`: `{email,password,channel?}`. Returns a safe user object and an HttpOnly SameSite=Strict session cookie (Secure in an HTTPS hosted deployment). Requires an exact Origin header. POST `/api/v1/auth/logout` revokes the session and clears the cookie. GET `/api/v1/auth/session` returns `{user,modes,mode,source}`. Accounts are provisioned with `pnpm user:create`, not public registration.

Rates require an end-user session to resolve the account’s saved carrier credentials (browser calls require Origin). A deployment-wide APP_API_KEY alone cannot quote because it does not identify an account. Profile and carrier-settings routes require a session. There is no permissive CORS response.

## Rates

POST `/api/v1/rates` accepts:

```json
{
  "ship_from": {
    "city": "Vancouver",
    "region": "BC",
    "postal_code": "V6B 1A1",
    "country_code": "CA"
  },
  "ship_to": {
    "city": "Toronto",
    "region": "ON",
    "postal_code": "M5V2T6",
    "country_code": "CA"
  },
  "shipDate": "2026-10-13",
  "packages": [
    {
      "length": 30,
      "width": 20,
      "height": 15,
      "dimensionUnit": "cm",
      "weight": 2.5,
      "weightUnit": "kg"
    }
  ],
  "signatureRequired": true,
  "coverageAmount": 500,
  "coverageCurrency": "CAD",
  "carriers": ["canada_post", "loomis", "fedex"],
  "carrierMode": "production"
}
```

Both independent address objects are required. Optional address fields are `contact_name`, `company`, `address_line1`, `address_line2`, `phone`, and `email`. Required fields are `city`, `region`, `postal_code`, and a two-letter country code (default CA). Canadian codes normalize to uppercase without spaces; US ZIPs remain strings. Dimensions use cm/in; weight uses kg/lb; only one package is accepted. Positive dimensions/weight have a 1000 input maximum; coverage is 0–99999.99 CAD. Actual carrier limits can be lower.

Optional `ship_from_profile_id` must be an owned UUID. Explicit displayed addresses take precedence; the profile ID is only a reference. Requests never accept carrier URLs, credentials, account numbers, or `user_id`. The final contract uses `ship_from`/`ship_to`; old `origin`/`destination` example keys are not accepted.

The response is `{requestId,quotedAt,mode,appEnvironment,results,carrierStatuses}`. Each result includes carrier/service code/name, variant, currency, source (`mock|live_carrier`), mode, ETA `{kind,date,businessDays}`, signature `{requested,available,includedInQuote}`, notices, breakdown and:

```json
{
  "withoutCoverage": {
    "available": true,
    "total": "22.50",
    "taxIncluded": true,
    "breakdown": []
  },
  "withCoverage": {
    "available": true,
    "total": "26.50",
    "taxIncluded": true,
    "breakdown": [],
    "declaredValue": "500.00",
    "status": "quoted"
  },
  "coverageDifference": "4.00"
}
```

These numbers are synthetic fixtures. Money is a decimal string. Coverage status is `quoted`, `not_quoted`, `not_supported`, or `carrier_error`; missing covered amounts/differences are null. ETA kinds are estimated_date, guaranteed_date, transit_days, or unavailable; dates are never fabricated from transit days. Each carrier status includes carrier, mode, source, status and safe message; status can be success, unconfigured, disabled, unavailable, timeout or error. Partial/all carrier failures remain a valid comparison response with explicit statuses and possibly no rows.

GET `/api/v1/carriers?mode=sandbox` exposes only configured/disabled/unconfigured statuses. Both modes require a signed-in account and use that account’s enabled credentials. GET `/api/v1/health` returns `{status:"ok"}` without secrets (liveness only).

## Saved origins

GET `/api/v1/ship-from-profiles` returns `{profiles:[...]}` for the current user. POST creates with `{profile_name,address,is_default?}` and returns the record with HTTP 201. GET `/api/v1/ship-from-profiles/{id}` retrieves an owned profile. PATCH accepts optional profile_name, a complete address object, and/or is_default; omitted values are preserved. DELETE returns 204. PUT `/api/v1/ship-from-profiles/{id}/default` sets the default transactionally and returns the record.

Profile records contain id, user_id, profile_name, the flat address fields, is_default, created_at, and updated_at. IDs are UUIDs; timestamps are UTC ISO strings. Names are unique per user ignoring case; defaults are unique per user. No global address book or client-controlled ownership is exposed.

## Account carrier settings

GET `/api/v1/carrier-settings?mode=sandbox` (or production) returns the signed-in account’s settings for each carrier, with public fields and savedSecrets booleans. Secret values are never returned. PUT `/api/v1/carrier-settings/{mode}/{carrier}` accepts `{enabled, baseUrl, fields, quoteType?, clearCredentials?}`; only the selected carrier's documented credential fields and official URL are accepted. Blank secret fields retain saved values. Set clearCredentials to true to discard previously saved credentials before applying fields. The web UI’s Clear settings action edits only the draft; Save settings persists the clearing. DELETE on that path clears credentials and disables the carrier. Ownership comes exclusively from the session; clients cannot specify another account. Secret payloads must not be logged. Settings changes apply to the next quote, with no environment-file fallback.

## Area routing and connection checks

The production API is `/api/v1/*`; sandbox / UAT uses `/sandbox/api/v1/*`. Both require the same authenticated session. Session responses report the area's mode. Carrier settings and rates must match the API area's mode; mismatches return 400 ENVIRONMENT_MISMATCH before any carrier request. If carrierMode is omitted from a rate request, the API area's mode is used. Roles and environment flags do not select carrier traffic; the account's saved credentials and enabled switch do.

POST `/api/v1/carrier-settings/production/{carrier}/test` or `/sandbox/api/v1/carrier-settings/sandbox/{carrier}/test` checks saved credentials without saving, enabling or booking anything. It sends a small domestic rate request, with a 30-second server timeout and per-account/carrier throttling. Success/error/timeout/unconfigured status and a safe message are returned, including HTTP/code details where available. Credentials are never returned.

Each real rate row includes apiResult containing its original per-service carrier response object; withCoverage.apiResult contains the matching covered response when present. These fields expose carrier rate results for the signed-in account, not authentication responses or request credentials. XML carrier results are represented as parsed objects. Rates remain transient and are not stored.

## Administrator accounts and access

Admin web sessions may manage accounts at `/admin` or `/sandbox/admin`. The account list is shared across both areas.

- GET `/api/v1/admin/accounts`: `{accounts:[{id,email,role,webAccess,apiAccess,created_at}]}`; passwords are never returned.
- POST `/api/v1/admin/accounts`: `{email,password,role,webAccess,apiAccess}`; creates an account with HTTP 201. Roles: user, operator, admin. Passwords require at least 6 characters.
- PATCH `/api/v1/admin/accounts/{id}`: any subset of these fields; omit password to preserve it. Changes revoke all sessions for that account.
- DELETE `/api/v1/admin/accounts/{id}`: HTTP 204; cascades sessions, profiles and carrier settings. Self deletion is blocked.

Sandbox uses the same paths under `/sandbox/api/v1`. All writes require Origin. Nonadmins and integration API sessions receive HTTP 403 ADMIN_REQUIRED. Removing or disabling the last admin with web access returns HTTP 409 LAST_ADMIN. Duplicate email returns 409 EMAIL_CONFLICT; self deletion returns 409 SELF_DELETE.

Login accepts optional `channel: "api" | "web"` (default `api`). Integration login requires API access; website login uses `web` and requires Web access. Web sessions authorize the calculator's backend calls even when integration API access is disabled. API sessions cannot open protected web pages or manage accounts. Access grants are checked on each authenticated request. Existing accounts retain both grants; newly created accounts use the grants selected by the administrator.

### Loomis production URL

Production Loomis accepts an account-entered HTTPS SOAP 1.1 rating endpoint on an official `loomis-express.com` or `loomisexpress.com` domain, with USERNAME, PASSWORD and ACCOUNT_NUMBER. Supply the carrier-provided operation endpoint, not a `?wsdl` URL. Sandbox/test hosts, non-HTTPS URLs, user-info, custom ports, query strings and fragments are rejected. No production URL or credentials are copied from sandbox. Save settings, then use the connection-test endpoint to verify the integration with the carrier. Production shipments require street addresses, contact names or companies, and phone numbers at both ends. International customs requests remain unsupported.
