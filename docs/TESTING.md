# Testing

`pnpm test:env` uses Node's built-in test runner without extra dependencies. It verifies empty secrets in both samples, the absence of carrier credentials in deployment templates, database-provider selection, and sandbox/production isolation. These tests use synthetic environment objects and never load actual credentials.

`pnpm test` runs unit and integration contracts for validation, units, money, mock scenarios, carrier builders/parsers, XML rejection, authentication primitives, profile ownership/defaults, and transfer. `pnpm test:postgres` runs the equivalent profile contract when `TEST_POSTGRES_URL` points at a dedicated test database; otherwise it skips. Tests never enable live production carrier traffic.

`pnpm test:e2e` provisions a synthetic account in an ignored SQLite test database and runs Chromium desktop/mobile flows: login, origin profile creation/default/reload, independent destination, unit switches, coverage quotes, stale-result clearing, and authentication/mode rejection. Install Chromium first using `pnpm exec playwright install chromium`.

For opt-in sandbox smoke testing start the server with `MOCK_CARRIERS=false` and sandbox credentials, then run `RUN_SANDBOX_SMOKE=true pnpm test:live:sandbox`. The script authenticates with the configured USER_EMAIL/USER_PASSWORD (legacy CREATE_USER_* also supported) and uses the account’s saved carrier settings. Missing opt-in skips. Synthetic responses are rejected, and carrier errors are printed with a failing exit code. Production smoke traffic is not implemented.

## Actual verification (2026-10-09)

- Dependencies installed using repository-local Node 22 and pnpm 10. PostgreSQL migrations passed on the isolated instance at port 55432.
- Typecheck, targeted ESLint, and 36 core, clipboard-table, suggestion, and carrier regression tests passed. Carrier tests cover SOAP mapping, actual returned totals, safe API errors, and failed coverage requests retaining real base rates.
- With `MOCK_CARRIERS=false`, the final credentialed sandbox request returned six FedEx account services, four Loomis services (including with blank optional contact fields), and three Canada Post counter rates. Canada Post commercial requests returned HTTP 403 / AA004 with both the configured and documented test customer; counter requests with the same credentials succeeded. Counter rates are explicitly configured and labeled; no replacement prices are generated.
- A Chromium browser check signed in, requested actual carrier quotes, verified visible errors and clipboard output, and checked mobile overflow. The updated results check verified animated per-carrier quoting, lowest-price ordering, tax default/toggle behavior, and formatted copying through both ClipboardItem and the legacy fallback.
- These checks do not certify production carrier accounts. A production build, Docker build, and the complete end-to-end suite remain outside this verification.

## Docker startup verification (2026-10-10)

The development image built successfully with the frozen lockfile and Node 22. Docker Compose started PostgreSQL and the web service; both became healthy and the web port is published on 127.0.0.1:3000. Database migration and account provisioning completed. Page and configured-account sign-in checks from inside the web container returned HTTP 200, and the session reported sandbox/live_carrier. Direct host-port verification from the restricted agent session was unavailable. An isolated SQLite provisioning check confirmed that a second startup preserves the existing user ID, password hash, and role. Typecheck, targeted lint, and seven environment tests passed. Production image verification remains separate.

## Account carrier settings — 2026-10-10

Migration 002 adds per-account, per-environment carrier settings. The regression suite passed 49 tests with one optional PostgreSQL test skipped. New tests verify encryption, secret masking, account/mode isolation, blank-secret preservation, clearing and disabling, rejection of foreign URLs, and quoting with saved credentials instead of environment values. Environment checks passed after removing carrier fields from both deployment templates.

Docker sandbox API checks confirmed sign-in, credential saves/reloads, masked secret responses, separate production defaults, 401 for unauthenticated settings, 400 for foreign API URLs, and a disabled carrier producing no rates. Existing configured sandbox credentials were moved to the signed-in account, removed from the private environment file, and verified again after recreating the web container. Actual account-backed quotes returned Canada Post and Loomis rates; FedEx timed out. The encryption key must be backed up with the database.

After web-container recreation, health returned HTTP 200 and the process contained zero carrier environment entries; saved settings remained usable. Typecheck and targeted lint passed. Chromium could not launch because the restricted environment denied a socket operation, so the new settings layout was not browser-verified in this run.

## Routed areas and login guards — 2026-10-10

The app now serves production at /home, /rate and /setting, with sandbox/UAT equivalents under /sandbox. Dedicated login pages use safe return paths. Server-side guards redirect unauthenticated or expired sessions; API 401 responses redirect immediately, and visible-tab/30-second session checks catch idle expiry. Routing tests reject cross-area settings, rate requests and connection probes before carrier traffic. Client tests cover expired-session redirects and incorrect-password errors remaining on the login form.

Live Docker verification passed for six protected pages, both login pages, signed-in access, root redirects, separate credential areas, mode mismatch rejection and a revoked-session redirect. A saved Canada Post sandbox connection probe succeeded with three returned services. Production probes with missing credentials returned unconfigured. The local Compose stack remains healthy; carrier settings and database volumes were preserved during env/local.env migration. Browser execution is restricted in this environment, so these new page flows were verified through live HTTP checks and regression tests rather than a full browser run.

## Administrator accounts and access grants

Account administration adds five automated tests covering CRUD, password reset, independent web/API login grants, session revocation, admin authorization, Origin checks, duplicate emails, last-admin protection and cascading deletion. Full suite: 61 passed, one optional PostgreSQL test skipped. Typecheck and targeted lint passed.

Live Docker/PostgreSQL checks confirmed the configured account is admin, both admin page routes return HTTP 200 for admin web sessions and redirect anonymous requests to login, regular users receive HTTP 403 for management endpoints, and web-only/API-only accounts enforce login channels. Temporary accounts were deleted after verification. These are HTTP/API checks, not browser interaction tests.

## Carrier settings draft clearing

Clear settings now changes only the local form. Save settings uses PUT with clearCredentials=true to remove stored secrets; normal blank secret inputs retain their saved values. Carrier-card feedback distinguishes unsaved changes, saved changes and errors. Fourteen targeted tests, typecheck and lint passed.

Live Docker/PostgreSQL verification used temporary accounts to save and reload FedEx, Canada Post and Loomis settings in both production and sandbox, retain secrets on a normal blank update, and clear secrets only on explicit save. All six carrier/mode cases passed. No carrier rate requests were sent, existing account settings were not modified, and temporary accounts were deleted.

## Settings connection UI and unsaved changes

Connection checks now show checking/success/error/timeout/unavailable states, status icons, returned messages, server response duration and client check time in each carrier card. Clearing remains a local draft action until save. Unsaved changes guard app links, explicit sign out, refresh/tab close and cancellable Navigation API back/forward events. Five event-handler tests cover cancelled and approved links, same-page/new-tab exceptions, unload warnings, cleanup after save, history cancellation and sign out. Typecheck and targeted lint passed. Browser visual interaction was not tested in this sandbox.
