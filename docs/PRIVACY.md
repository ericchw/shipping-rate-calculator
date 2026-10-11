# Data and privacy

The database retains account emails, password hashes, access grants, sessions, saved origin profiles and encrypted carrier settings. Profiles may contain names, company details, street addresses, phone numbers and emails. Carrier account metadata is visible to its owning account.

Quote requests send shipment addresses, package measurements and requested options to the selected carriers. Quotes and ad hoc addresses are not stored by this application; carriers may retain them under their own terms. Operators should configure proxy/application logs to avoid recording request bodies, cookies and authorization headers.

The browser stores hidden-service preferences under an account-ID/environment key. Older browser versions may have left email-based preference keys in local storage; clear site data on shared devices. Signing out expires the session but does not erase saved profiles. Clipboard exports, especially raw carrier API results, may contain addresses or account identifiers: review before sharing.

Admin account deletion removes dependent account data through foreign keys. Backups and carrier-held records require separate retention/deletion procedures. No automatic retention policy or data-export workflow is implemented. Protect PostgreSQL volumes, SQLite files, backups and encryption keys with restricted access.

Before publishing, inspect staged files and repository history, replace personal examples, and confirm hosting visibility. Ignore rules do not establish that a hosted repository is private.
