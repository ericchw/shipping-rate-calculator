/* eslint-disable @typescript-eslint/no-require-imports -- Node test entrypoint uses CommonJS. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { scryptSync } = require("node:crypto");

test("standalone provisioning creates a usable login and preserves existing credentials and role", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "shipping-runtime-user-"));
  const file = path.join(directory, "test.db");
  const db = new DatabaseSync(file);
  try {
    db.exec(readFileSync("migrations/sqlite/001_initial.sql", "utf8"));
    const env = { ...process.env, DATABASE_PROVIDER: "sqlite", DATABASE_URL: `file:${file}`,
      USER_EMAIL: "operator@example.test", USER_PASSWORD: "synthetic#password", CREATE_USER_ROLE: "operator" };
    const run = (overrides = {}, args = ["--if-missing"]) => spawnSync(process.execPath,
      ["scripts/runtime-create-user.cjs", ...args], { env: { ...env, ...overrides }, encoding: "utf8" });
    assert.equal(run().status, 0);
    const first = db.prepare("SELECT * FROM users").get();
    const [salt, hash] = first.password_hash.split(":");
    assert.equal(scryptSync(env.USER_PASSWORD, salt, 64).toString("hex"), hash);
    assert.equal(first.role, "operator");
    assert.equal(run({ USER_PASSWORD: "changed#password", CREATE_USER_ROLE: "admin" }).status, 0);
    assert.deepEqual(db.prepare("SELECT * FROM users").get(), first);
    assert.equal(run({ USER_PASSWORD: "short" }).status, 1);
    assert.equal(run({ USER_EMAIL: "", USER_PASSWORD: "", CREATE_USER_EMAIL: "", CREATE_USER_PASSWORD: "" }, ["--optional"]).status, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
