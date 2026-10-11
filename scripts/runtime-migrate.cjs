// Production maintenance entrypoint; no development dependencies required.
const { DatabaseSync } = require("node:sqlite");
const { Pool } = require("pg");
const { readFileSync, mkdirSync, readdirSync } = require("node:fs");
const path = require("node:path");
async function main() {
  const provider = process.env.DATABASE_PROVIDER || "postgresql";
  const url =
    process.env.DATABASE_URL ||
    (provider === "sqlite" ? "file:./data/shipping.db" : "");
  const directory = path.join(process.cwd(), "migrations", provider);
  const migrations = readdirSync(directory).filter((file) => /^\d+.*\.sql$/.test(file)).sort()
    .map((file) => readFileSync(path.join(directory, file), "utf8"));
  if (provider === "sqlite") {
    if (!url.startsWith("file:")) throw new Error("Invalid SQLite URL");
    const file = url.slice(5);
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    const db = new DatabaseSync(file);
    try {
      db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
      for (const sql of migrations) db.exec(sql);
    } finally {
      db.close();
    }
  } else if (provider === "postgresql") {
    const pool = new Pool({ connectionString: url });
    try {
      for (const sql of migrations) await pool.query(sql);
    } finally {
      await pool.end();
    }
  } else throw new Error("Unsupported provider");
  console.log("Database migrations applied.");
}
main().catch(() => {
  console.error("Migration failed. Check database configuration and access.");
  process.exitCode = 1;
});
