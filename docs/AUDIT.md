# Repository review — 2026-10-10

The project has useful setup, architecture, database and API documentation and meaningful integration tests. It is suitable as a portfolio project when its operational limits are stated honestly. This review does not certify production security.

## Findings addressed

- Database transfer dropped Web/API access grants and could restore disabled access. Transfers now preserve grants. Source databases must have current migrations; sessions and encrypted carrier settings remain deliberately excluded.
- Password verification and session creation could race with an administrator password reset. Login now locks and rechecks the account and creates the session/channel atomically.
- An API session could cause a browser login/home redirect loop. Browser session handling now requires web access and a web session.
- Standalone build tracing attempted to package the runtime encryption key. Private data, environment files, keys and exports are now explicitly excluded from Next.js tracing as well as Docker context.
- Docker exclusions missed database exports, private keys and logs. Exclusions now cover these files. SQLite files are set to owner read/write, and the local production environment file was restricted to owner read/write.
- Browser preference keys exposed email addresses. New keys use account IDs. Old browser storage requires site-data cleanup.
- README clear-settings behavior, architecture credential wording, database table/transfer descriptions and a personal account example were corrected.

## Remaining risks and limits

Dependency audit failed because registry.npmjs.org DNS resolution returned EAI_AGAIN. Installed Next.js 15.5.18 predates the maintainer's [August security release](https://nextjs.org/blog/august-2026-security-release), which provides 15.5.24, and [September hardening release](https://nextjs.org/blog/nextjs-security-update-september-22-2026), which provides 15.5.26. Upgrade to the latest supported 15.5 patch and matching eslint-config-next, install the lockfile and repeat audit/build tests before deployment. Exploitability depends on the affected feature; the September ImageResponse RCE specifically does not affect Next.js 15. This review did not establish the latest available patch.

Rate limiting is local to one process. MFA, durable administrative audit logs, automatic privacy retention and a nonce-based CSP are absent. Public hosting needs HTTPS, restricted database/key access, backup procedures and dependency maintenance. UI zero/blank measurements become one in the selected unit: users must enter actual measurements for reliable quotes.

No configured Git remote or tracked project files were found in the available checkout context. Hosted repository visibility and historical secret disclosure could not be verified. A local file scan did not identify credential literals in reviewed public sources; this is not a guarantee that no secret exists. Live production carrier calls and fresh browser interaction tests were not performed in this review.

## Verification

Before fixes: 73 tests passed, one optional PostgreSQL test skipped, TypeScript check passed, and seven environment tests passed. Regression coverage was added for grant preservation, password-reset/login races and browser API sessions. Post-fix: 75 tests passed, one optional PostgreSQL test skipped; TypeScript, ESLint on changed code, and all seven environment tests passed. Browser regression checks cover session-selection logic, rather than a fresh browser interaction run.

Production build passed after tracing exclusions. A post-build scan found no private runtime data or environment files in server trace manifests.
