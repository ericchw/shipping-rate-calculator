import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { Store } from "../src/lib/db";
const email = (process.env.USER_EMAIL ?? process.env.CREATE_USER_EMAIL)?.toLowerCase();
const password = process.env.USER_PASSWORD ?? process.env.CREATE_USER_PASSWORD;
const role = process.env.CREATE_USER_ROLE ?? "user";
if (
  !email ||
  !/^\S+@\S+\.\S+$/.test(email) ||
  !password ||
  password.length < 6 ||
  !["user", "operator", "admin"].includes(role)
)
  throw new Error(
    "Set USER_EMAIL, USER_PASSWORD (6+ characters), and optional CREATE_USER_ROLE in the local environment.",
  );
const salt = randomBytes(16).toString("hex");
const hash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
const store = new Store();
await store.migrate();
if (process.argv.includes("--if-missing")) {
  const existing = await store.query("SELECT id FROM users WHERE email = ?", [email]);
  if (existing.length) {
    await store.close();
    console.log("Configured account already exists; password and profiles preserved.");
    process.exit(0);
  }
}
await store.query(
  "INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)",
  [randomUUID(), email, hash, role, new Date().toISOString()],
);
await store.close();
console.log(process.argv.includes("--if-missing")
  ? "Configured account created."
  : "User created. Remove the provisioning password from the environment.");
