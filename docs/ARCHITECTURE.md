# Architecture

The App Router page renders a client form with independent origin/destination inputs, parcel units, signature/declared value, profile management, and rate results. A protected Route Handler dispatches `/api/v1` requests. Carrier integrations import `server-only`; the browser receives masked secret indicators and editable account metadata, never saved secret values.

Zod validates requests; decimal.js handles conversion and money. The quote service concurrently calls configured carriers, with one bounded deadline per carrier covering both scenarios, and retains partial results. Coverage matches use service code, packaging/rate variant, currency, and tax basis. Signature settings and shipment inputs remain identical in both scenarios. Unknown or failed coverage quotes have null prices and explicit status.

`Store` implements a common parameterized-query and transaction interface over Node's SQLite driver and `pg`. PostgreSQL is configured in deployment templates; SQLite remains an explicit local option. Migrations enforce ownership foreign keys, per-user profile names, and one default. PostgreSQL profile writes lock the user row before default changes; SQLite serializes writes in `BEGIN IMMEDIATE`. Sessions are random 256-bit tokens stored as SHA-256 hashes; passwords use per-password salted scrypt. Sessions expire after eight hours.

Rate integrations are stateless beyond a bounded FedEx OAuth cache keyed by mode/account/client identity. No quotes or ad hoc shipment addresses are persisted. Saved profiles are user-owned personal data. Database provider selection is startup configuration. Transfer copies users, account access grants, and profiles transactionally into an empty database and deliberately omits sessions.

Operational limits: current throttling is in process; run one app instance or enforce distributed limits at the proxy. The health endpoint is liveness only, not database readiness. Loomis production accepts a carrier-provided SOAP rating endpoint; production integrations require credentialed validation. Startup runs sorted, idempotent migration files. New migrations must remain safe to rerun.
