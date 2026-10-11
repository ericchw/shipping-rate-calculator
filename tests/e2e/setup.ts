import { randomUUID, scryptSync, randomBytes } from "node:crypto";
import { Store } from "../../src/lib/db";
export default async function setup() {
  const store = new Store("sqlite", "file:./data/e2e.db");
  await store.migrate();
  const salt = randomBytes(16).toString("hex");
  const password = `${salt}:${scryptSync("fixture-password-only", salt, 64).toString("hex")}`;
  await store.query("DELETE FROM users WHERE email=?", ["e2e@example.invalid"]);
  await store.query(
    "INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)",
    [
      randomUUID(),
      "e2e@example.invalid",
      password,
      "user",
      new Date().toISOString(),
    ],
  );
  await store.close();
}
