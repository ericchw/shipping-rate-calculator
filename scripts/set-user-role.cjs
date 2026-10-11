/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node entrypoint uses CommonJS. */
// Bootstrap an administrator without changing the account's password.
const { Pool } = require("pg");
const { DatabaseSync } = require("node:sqlite");
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const role = process.argv[3];
  if (!email || !["user", "operator", "admin"].includes(role)) throw new Error("Usage: node scripts/set-user-role.cjs EMAIL ROLE");
  let query, close;
  if (process.env.DATABASE_PROVIDER === "postgresql") {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    query = async (sql, values) => (await pool.query(sql, values)).rows;
    close = () => pool.end();
  } else if (process.env.DATABASE_PROVIDER === "sqlite" && process.env.DATABASE_URL?.startsWith("file:")) {
    const db = new DatabaseSync(process.env.DATABASE_URL.slice(5));
    db.exec("PRAGMA foreign_keys=ON");
    query = async (sql, values) => db.prepare(sql.replace(/\$\d+/g, "?")).all(...values);
    close = () => db.close();
  } else throw new Error("Invalid database configuration");
  try {
    await query("BEGIN", []);
    if (process.env.DATABASE_PROVIDER === "postgresql") await query("SELECT pg_advisory_xact_lock(83192648)", []);
    const account = (await query("SELECT id,role FROM users WHERE lower(email)=$1", [email]))[0];
    if (!account) throw new Error("Account not found");
    if (account.role === "admin" && role !== "admin") {
      const others = await query("SELECT u.id FROM users u LEFT JOIN account_access a ON a.user_id=u.id WHERE u.role='admin' AND COALESCE(a.web_access,1)=1 AND u.id<>$1", [account.id]);
      if (!others.length) throw new Error("Keep at least one administrator with web access");
    }
    await query("UPDATE users SET role=$1 WHERE id=$2 RETURNING id", [role, account.id]);
    if (role === "admin") await query("INSERT INTO account_access (user_id,web_access,api_access) VALUES ($1,1,1) ON CONFLICT(user_id) DO UPDATE SET web_access=1 RETURNING user_id", [account.id]);
    await query("DELETE FROM sessions WHERE user_id=$1 RETURNING token_hash", [account.id]);
    await query("COMMIT", []);
    console.log(`${email}: role updated to ${role}. Existing sessions revoked; password preserved.`);
  } catch (error) { await query("ROLLBACK", []); throw error; }
  finally { await close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
