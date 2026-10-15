"use client";
import { useState } from "react";
import Link from "next/link";
import ApiCode, { CopyCode } from "./ApiCode";
import type { AppMode } from "@/lib/app-routes";
import { apiPath } from "@/lib/app-routes";
import { carrierDefinitions } from "@/lib/carrier-settings-schema";

const endpoints = [
  ["GET", "health", "Public liveness check. Returns {status: 'ok'}; does not test carriers."],
  ["POST", "auth/login", "Body: {email, password, channel?}. channel defaults to api; the website uses web. Requires the corresponding access grant and Origin. Returns {user} and a session cookie."],
  ["GET", "auth/session", "Returns {user, group, generationEnabled, modes, mode, source}. user is null when signed out."],
  ["POST", "auth/logout", "Revokes the session; returns {ok: true}. Requires Origin."],
  ["POST", "rates", "Compare and save shipment details, returned prices and carrier statuses using this company group’s enabled connections. Returns quoteLogId."],
  ["GET", "carriers", "Returns {mode, source, carriers}: configured, disabled or unconfigured."],
  ["GET", "carrier-settings", "Returns {settings}. Users receive carrier, mode, enabled and configured only. Admin web sessions receive editable public fields and savedSecrets flags."],
  ["PUT", "carrier-settings/{mode}/{carrier}", "Admin web session only. Save company settings with {enabled, baseUrl, fields, quoteType?, clearCredentials?}. Blank secrets retain saved values unless clearCredentials is true."],
  ["DELETE", "carrier-settings/{mode}/{carrier}", "Admin web session only. Clear group credentials and disable the carrier; returns its cleared settings."],
  ["POST", "carrier-settings/{mode}/{carrier}/test", "Admin web session only. Test group credentials with a real rate request. Returns status, message and milliseconds (when a request is made). No shipment is booked."],
  ["GET", "ship-from-profiles", "Returns {profiles} belonging to the signed-in account."],
  ["POST", "ship-from-profiles", "Create {profile_name, address, is_default?}. Returns a profile with HTTP 201."],
  ["GET", "ship-from-profiles/{id}", "Retrieve an owned profile; id is a UUID."],
  ["PATCH", "ship-from-profiles/{id}", "Update optional profile_name, complete address and/or is_default; returns the profile."],
  ["DELETE", "ship-from-profiles/{id}", "Delete an owned profile. Returns HTTP 204 with no body."],
  ["PUT", "ship-from-profiles/{id}/default", "Set the account’s default origin; returns the profile."],
  ["GET", "admin/groups", "Admin web session only. List company groups and member counts."],
  ["POST", "admin/groups", "Admin web session only. Create {name}; returns HTTP 201."],
  ["DELETE", "admin/groups/{id}", "Admin web session only. Delete an empty company and its credentials. Members or shipment history block deletion with HTTP 409."],
  ["PATCH", "admin/groups/{id}", "Admin web session only. Rename with {name}."],
  ["GET", "admin/generation-settings", "Admin web session only. Group permission for this area; optional ?groupId=GROUP_UUID. Defaults disabled."],
  ["PUT", "admin/generation-settings", "Admin web session only. Save {enabled} for this company group and area; optional ?groupId=GROUP_UUID."],
  ["GET", "rate-logs", "List company comparisons with page/pageSize (10,20,50,100). Admin web sessions may use ?groupId=GROUP_UUID."],
  ["DELETE", "rate-logs/{id}", "Delete one company comparison after confirmation in the UI. Returns 204; active comparisons return 409. Shipping labels remain."],
  ["GET", "rate-logs/{id}", "View saved shipment details, prices and carrier statuses; another company’s ID returns 404."],
  ["GET", "labels", "List company labels; page and pageSize (10,20,50,100). Admins may select ?groupId=GROUP_UUID."],
  ["GET", "labels/{id}", "View a company label, its original PNGs and shipment details. Other company IDs return 404."],
  ["POST", "loomis/labels", "Sandbox only. Generate with {shipment, serviceCode}; requires the company generation permission and enabled Loomis credentials."],
  ["GET", "admin/accounts", "Admin web session only. Returns {accounts} with roles and web/API grants; passwords are never returned."],
  ["POST", "admin/accounts", "Admin web session only. Create {email, password, role, webAccess, apiAccess, productionAccess?, uatAccess?, groupId}. New accounts default to UAT access only. Password requires at least 6 characters; returns HTTP 201."],
  ["PATCH", "admin/accounts/{id}", "Admin web session only. Edit email, optional password, role, groupId and/or webAccess/apiAccess/productionAccess/uatAccess. Revokes that account’s sessions."],
  ["DELETE", "admin/accounts/{id}", "Admin web session only. Delete account, sessions and saved addresses; company labels and credentials remain. HTTP 204. Self deletion and removal of the last web admin are blocked."],
] as const;

export default function ApiDocs({ mode }: { mode: AppMode }) {
  const [search, setSearch] = useState("");
  const base = apiPath(mode, "").replace(/\/$/, "");
  const sample = {
    ship_from: { city: "Vancouver", region: "BC", postal_code: "V6B1A1", country_code: "CA" },
    ship_to: { city: "Toronto", region: "ON", postal_code: "M5V2T6", country_code: "CA" },
    shipDate: "2026-10-13",
    packages: [{ weight: 5, weightUnit: "lb", length: 12, width: 8, height: 6, dimensionUnit: "in" }],
    signatureRequired: true, coverageAmount: 500, coverageCurrency: "CAD",
    carriers: ["canada_post", "loomis", "fedex"], carrierMode: mode,
  };
  const sections = [["api-overview", "Overview"], ["api-auth", "Authentication"], ["api-endpoints", "Endpoint reference"], ["api-rates", "Rate requests"], ["api-settings", "Carrier settings"], ["api-errors", "Errors & limits"]];
  const matches = endpoints.filter(endpoint => endpoint.join(" ").toLowerCase().includes(search.toLowerCase()));
  return <div className="api-docs-layout">
    <aside className="api-docs-sidebar">
      <span className="api-docs-eyebrow">DEVELOPER GUIDE</span><strong>Shipping API <small>v1</small></strong>
      <nav aria-label="API documentation sections">{sections.map(([id, title]) => <a key={id} href={`#${id}`}>{title}</a>)}</nav>
      <div className="api-docs-sidebar-note"><span>Authentication</span><strong>Session cookie</strong><p>OAuth / JWT tokens are not enabled.</p></div>
    </aside>
    <article className="api-docs">
    <section className="panel api-docs-hero" id="api-overview">
      <span className="api-docs-eyebrow">HTTP API · VERSION 1</span>
      <h2>Build with shipping rates</h2>
      <p>Connect your application to Canada Post, FedEx and Loomis. Compare services, manage carrier connections and reuse saved addresses.</p>
      <div className="api-docs-environments"><Link href="/docs" aria-current={mode === "production" ? "page" : undefined}>Production</Link><Link href="/sandbox/docs" aria-current={mode === "sandbox" ? "page" : undefined}>Sandbox / UAT</Link></div>
      <div className="api-base"><div><span>Current API base path</span><code>{base}</code></div><CopyCode value={base} label="Copy path" /></div>
      <p>Use the examples below with your deployment origin. All endpoints return JSON, except successful profile deletion (HTTP 204).</p>
      <p>Production base: <code>/api/v1</code>. Sandbox / UAT base: <code>/sandbox/api/v1</code>. Examples below use <strong>{mode}</strong>: <code>{base}</code>.</p>
      <p>Both areas share account sessions and company group assignments. Carrier credentials and enabled settings are separate for each area. A mismatched mode returns HTTP 400 <code>ENVIRONMENT_MISMATCH</code>. Omitting carrierMode uses the route’s mode.</p>

    </section>
    <section className="panel" id="api-auth">
      <h2>Authentication and calling the API</h2>
      <p>Log in with an existing account and retain the returned session cookie. Rate requests, profiles and carrier settings require that session; an APP_API_KEY alone cannot identify an account. OAuth authorization and JWT bearer tokens are not currently supported by this application API. FedEx OAuth credentials authenticate upstream carrier requests only. Sessions expire after eight hours and are revoked on logout. All POST, PUT, PATCH and DELETE calls require an Origin header matching the deployment’s APP_ORIGIN exactly. JSON bodies require Content-Type: application/json.</p>
      <p>Administrators grant Web and API access separately. Login defaults to channel: api and requires API access. The website sends channel: web and requires Web access; its session authorizes the backend calls needed by the calculator. An API session cannot open protected web pages or administer accounts, groups or carrier settings. Only admins create accounts; users and operators must have a company group. Account edits revoke existing sessions.</p>
      <p>Create <code>login.json</code> locally with your own credentials: <code>{'{"email":"you@example.com","password":"YOUR_PASSWORD"}'}</code>. Save the rate example below as <code>shipment.json</code>. Replace the date with your intended shipping date.</p>
      <ApiCode value={`# Use your deployment's exact origin (HTTPS for hosted deployments).
ORIGIN=http://localhost:3000
API="$ORIGIN${base}"

# Sign in and save the session cookie.
curl -sS -c cookies.txt -H "Origin: $ORIGIN" \\
  -H 'Content-Type: application/json' \\
  --data-binary @login.json "$API/auth/login"

# Request rates with the saved session.
curl -sS -b cookies.txt -H "Origin: $ORIGIN" \\
  -H 'Content-Type: application/json' \\
  --data-binary @shipment.json "$API/rates"

# Check the session or log out.
curl -sS -b cookies.txt "$API/auth/session"
curl -sS -b cookies.txt -X POST -H "Origin: $ORIGIN" "$API/auth/logout"`} language="Shell" title="Request example" />
      <p>Same-origin browser calls use <code>credentials: &quot;same-origin&quot;</code>. Session cookies are HttpOnly and SameSite=Strict, with Secure enabled for HTTPS hosting. Cross-origin browser access is not enabled. Expired or revoked sessions require another login.</p>
    </section>
    <section className="panel" id="api-endpoints">
      <h2>Endpoints</h2>
      <p>Paths are relative to <code>{base}</code>. Except health, login, logout and session, endpoints require a signed-in account. Optional <code>?mode={mode}</code> on carriers and carrier-settings must match this area.</p>
      <label className="api-search" htmlFor="api-endpoint-search">Find an endpoint<input id="api-endpoint-search" type="search" placeholder="Search rates, login, carrier settings…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <p className="api-result-count" role="status">{matches.length} of {endpoints.length} endpoints</p>
      <div className="api-endpoints">{matches.map(([method, path, description]) => <details className="api-endpoint" key={`${method}:${path}`}>
        <summary><span className={`api-method api-method-${method.toLowerCase()}`}>{method}</span><code>/{path}</code><span className="api-endpoint-expand" aria-hidden="true">+</span></summary>
        <div className="api-endpoint-body"><p>{description}</p><div className="api-endpoint-meta"><span>{["health", "auth/login", "auth/logout", "auth/session"].includes(path) ? "Session not required" : "Account session required"}</span>{method !== "GET" && <span>Origin required</span>}</div><ApiCode title="Endpoint" language="HTTP" value={`${method} ${base}/${path.replace("{mode}", mode)}`} /></div>
      </details>)}</div>
      {matches.length === 0 && <p>No endpoints match your search. Try a carrier name, path or HTTP method.</p>}
    </section>
    <section className="panel" id="api-rates">
      <h2>Rate request</h2>
      <ApiCode title="shipment.json" value={JSON.stringify(sample, null, 2)} />
      <h3>Request fields</h3>
      <div className="api-docs-table"><table><thead><tr><th>Field</th><th>Required</th><th>Type / default</th></tr></thead><tbody>{[
        ["ship_from / ship_to", "Yes", "Address objects"],
        ["shipDate", "Yes", "YYYY-MM-DD"],
        ["packages", "Yes", "Array containing one package"],
        ["signatureRequired", "No", "Boolean · false"],
        ["coverageAmount", "No", "Number · 0"],
        ["coverageCurrency", "No", "CAD"],
        ["carriers", "No", "Array · all three carriers"],
        ["carrierMode", "No", "Current API area"],
        ["ship_from_profile_id", "No", "Owned profile UUID"],
      ].map(([field, required, type]) => <tr key={field}><td><code>{field}</code></td><td>{required}</td><td>{type}</td></tr>)}</tbody></table></div>
      <p>Both addresses require city, region and postal_code; country_code defaults to CA. Optional fields: contact_name, company, address_line1, address_line2, phone and email. Supply real street/contact/phone information when testing carriers that require it. Canadian postal codes normalize to uppercase without spaces.</p>
      <p>City / province suggestions use <a href="https://www.zippopotam.us/">Zippopotam.us</a> / <a href="https://www.geonames.org/">GeoNames</a> postal data. Canadian suggestions cover the first three postal-code characters and do not verify the full delivery address.</p>
      <p>Exactly one package is supported. Measurements must be numeric and no more than 1000. Weight must be greater than zero. Dimensions must either all be greater than zero, or all be zero to omit dimensions from carrier requests. Actual measurements may change final charges when dimensions are omitted. Weight units: kg or lb. Dimension units: cm or in. coverageAmount is 0–99999.99, CAD only; zero omits coverage. signatureRequired defaults to false in the API, so send true to match the UI default. carriers defaults to all three carrier IDs; duplicate IDs are rejected. Optional ship_from_profile_id must identify your own saved UUID; explicit addresses take precedence.</p>
      <h3>Response</h3>
      <p>The response contains requestId, quotedAt, mode, appEnvironment, results and carrierStatuses. Each service row has carrier, serviceCode, serviceName, currency, source, mode, eta, signature, notices, breakdown, withoutCoverage and withCoverage.</p>
      <p>Prices are decimal strings. Coverage status is quoted, not_quoted, not_supported or carrier_error; unavailable amounts are null. ETA contains kind, date and businessDays; unavailable values are null. Signature reports requested, available and includedInQuote. API results are original per-service response objects in apiResult and withCoverage.apiResult; XML results are parsed objects. Comparisons and shipment details are saved in company rate logs. Raw carrier API results remain transient and do not expose request credentials.</p>
      <p>Carrier failures can still return HTTP 200 with partial or empty results. Always inspect carrierStatuses: success, disabled, unconfigured, unavailable, timeout or error. HTTP 200 alone does not mean every carrier succeeded. Display sorting and hidden-service preferences belong to the UI; the API returns carrier results without those display filters.</p>
    </section>
    <section className="panel" id="api-settings">
      <h2>Carrier settings and connection checks</h2>
      <p>Save settings through the Settings page or PUT endpoint. Credential field keys are case-sensitive:</p>
      <ul>{Object.entries(carrierDefinitions).map(([id, carrier]) => <li key={id}><strong>{carrier.name}</strong> (<code>{id}</code>): {carrier.fields.map(field => field.key).join(", ")}</li>)}</ul>
      <ApiCode value={JSON.stringify({ enabled: true, baseUrl: mode === "sandbox" ? "https://ct.soa-gw.canadapost.ca" : "https://soa-gw.canadapost.ca", fields: { API_KEY: "YOUR_API_KEY", API_SECRET: "YOUR_API_SECRET", CUSTOMER_NUMBER: "YOUR_CUSTOMER_NUMBER", CONTRACT_ID: "" }, quoteType: "commercial" }, null, 2)} />
      <p>Carrier connections belong to company groups. Only admin web sessions can save, clear or test them. Admins may pass ?groupId=GROUP_UUID to manage another company. User sessions receive status fields only and cannot select a different group. Secret values are never returned. Blank secret fields keep saved values; clearCredentials: true replaces them.</p>
      <ApiCode value={`curl -sS -b cookies.txt -X POST -H "Origin: $ORIGIN" \\
  "$API/carrier-settings/${mode}/canada_post/test"`} language="Shell" title="Request example" />
      <p>The connection check uses saved credentials, even if the carrier is disabled. It requests a domestic sample rate with a 30-second timeout and returns success, unavailable, error, timeout or unconfigured. Loomis production requires your carrier-provided SOAP 1.1 rating endpoint and production credentials. It does not save settings or book a shipment. Checks are limited to five per minute per account, carrier and mode.</p>
    </section>
    <section className="panel" id="api-errors">
      <h2>Errors and limits</h2>
      <ApiCode value={JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "Check the highlighted input fields", details: [{ path: ["packages", 0, "weight"], message: "Number must be greater than 0" }] }, requestId: "request-uuid" }, null, 2)} />
      <p>HTTP statuses: 400 invalid input or mode mismatch; 401 invalid login or expired session; 403 invalid Origin; 404 missing route or owned profile; 409 duplicate profile name; 413 JSON body exceeds 16 KiB; 429 throttled; 500 server failure. Unknown request fields are rejected. Responses use Cache-Control: no-store.</p>
      <p>Authenticated operations generally allow 30 requests per minute per account. Login allows five attempts per email per minute, with a global limit of 100 per minute. Limits are maintained by each running server process.</p>
    </section>
  </article></div>;
}
