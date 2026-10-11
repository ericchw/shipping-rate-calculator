/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node entrypoint uses CommonJS. */
// Provision an account in the standalone image without development dependencies.
const { randomBytes, randomUUID, scryptSync } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { Pool } = require("pg");

async function main() {
  const email = (process.env.USER_EMAIL ?? process.env.CREATE_USER_EMAIL)?.toLowerCase();
  const password = process.env.USER_PASSWORD ?? process.env.CREATE_USER_PASSWORD;
  const role = process.env.CREATE_USER_ROLE ?? "user";
  if (!email && !password && process.argv.includes("--optional")) {
    console.log("Account provisioning skipped; no account credentials configured.");
    return;
  }
  if (!email || !/^\S+@\S+\.\S+$/.test(email) || !password || password.length < 6 ||
      !["user", "operator", "admin"].includes(role))
    throw new Error("Invalid account configuration");
  const provider = process.env.DATABASE_PROVIDER;
  let query, close;
  if (provider === "postgresql") {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    query = async (sql, values) => (await pool.query(sql, values)).rows;
    close = () => pool.end();
  } else if (provider === "sqlite" && process.env.DATABASE_URL?.startsWith("file:")) {
    const db = new DatabaseSync(process.env.DATABASE_URL.slice(5));
    query = async (sql, values) => db.prepare(sql.replace(/\$\d+/g, "?")).all(...values);
    close = () => db.close();
  } else throw new Error("Invalid database configuration");
  try {
    if (process.argv.includes("--if-missing") && (await query("SELECT id FROM users WHERE email = $1", [email])).length) {
      console.log("Configured account already exists; password, role and profiles preserved.");
      return;
    }
    const salt = randomBytes(16).toString("hex");
    const hash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
    await query("INSERT INTO users (id,email,password_hash,role,created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [randomUUID(), email, hash, role, new Date().toISOString()]);
    console.log("Configured account created.");
  } finally {
    await close();
  }
}
main().catch(() => {
  console.error("Account provisioning failed. Configure USER_EMAIL, USER_PASSWORD (6+ characters), CREATE_USER_ROLE and database access.");
  process.exitCode = 1;
});
