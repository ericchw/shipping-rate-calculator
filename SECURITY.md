# Security

Passwords use salted scrypt; only hashes are stored. Sessions use random 256-bit tokens, hashed server-side, with eight-hour expiry and HttpOnly/SameSite=Strict cookies. Hosted deployments require HTTPS for Secure cookies. Admin account changes revoke sessions. Web/API access is enforced independently; administration requires a web-enabled administrator. Login now locks and rechecks the account before creating a session, preventing stale-password logins during resets.

Carrier secrets are encrypted using AES-256-GCM, bound to account/carrier/environment, and never returned by settings reads. Protect and back up the encryption key separately; losing it prevents credential recovery. Production and sandbox carrier configuration are separate, but accounts and saved addresses are shared.

Requests use schema validation, parameterized SQL, request-size limits and origin checks for mutations. Rate limits are in process: enforce distributed limits when running multiple replicas. The current password minimum is six characters; use long unique passwords. MFA, a durable administration audit trail, and a nonce-based CSP are not implemented.

Keep environment files, database exports, private keys and carrier reference documents out of source control and Docker build contexts. Local environment files should be owner-readable only. Docker/git exclusion rules reduce accidental disclosure but cannot remove previously published history. Never submit real credentials or customer addresses in a public issue.

Dependency scanning must be repeated before deployment. See [review results and verification limits](docs/AUDIT.md). Report vulnerabilities privately to the repository owner rather than posting exploitable details publicly.
