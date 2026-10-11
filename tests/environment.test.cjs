const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { loadEnvironment } = require("../scripts/run-env.cjs");
const directory = mkdtempSync(path.join(tmpdir(), "shipping-env-check-"));
const sample = (mode) =>
  parseEnv(readFileSync(path.resolve("env", `${mode}.env.example`), "utf8"));
const sandbox = () => ({
  ...sample("local"),
  DATABASE_PROVIDER: "sqlite",
  DATABASE_URL: "file::memory:",
});
const production = () => ({
  ...sample("production"),
  APP_ORIGIN: "https://production.example.test",
  DATABASE_PROVIDER: "sqlite",
  DATABASE_URL: "file::memory:",
});
test("both samples contain no tokens, passwords, account identifiers or credentialed URLs", () => {
  for (const mode of ["local", "production"])
    for (const [key, value] of Object.entries(sample(mode))) {
      if (
        /(API_KEY|SECRET|PASSWORD|USERNAME|CLIENT_ID|ACCOUNT_NUMBER|CUSTOMER_NUMBER|CONTRACT_ID|TOKEN|DATABASE_URL|USER_EMAIL|CREATE_USER_EMAIL)$/.test(
          key,
        )
      )
        assert.equal(value, "", `${mode}: ${key} must be empty`);
      if (/^(CANADA_POST|FEDEX|LOOMIS)_/.test(key))
        assert(
          !key.includes(mode === "sandbox" ? "_PRODUCTION_" : "_SANDBOX_"),
        );
    }
});
test("local deployment supports SQLite and the legacy sandbox command alias", () =>
  assert.equal(
    loadEnvironment("sandbox", sandbox(), directory).DATABASE_PROVIDER,
    "sqlite",
  ));
test("production deployment settings require real carrier data", () => {
  const env = loadEnvironment("production", production(), directory);
  assert.equal(env.APP_ENV, "production");
  assert.equal(env.MOCK_CARRIERS, "false");
  assert.throws(() => loadEnvironment("production", { ...production(), APP_ORIGIN: "" }, directory), /Missing APP_ORIGIN/);
  assert.throws(() => loadEnvironment("production", { ...production(), APP_ORIGIN: "http://localhost:3000" }, directory), /HTTPS/);
});
test("local deployment rejects carrier credentials in environment files", () => {
  assert.throws(
    () =>
      loadEnvironment(
        "sandbox",
        { ...sandbox(), FEDEX_PRODUCTION_CLIENT_SECRET: "synthetic" },
        directory,
      ),
    /account settings/,
  );

});
test("production rejects sandbox configuration and mock mode", () => {
  assert.throws(
    () =>
      loadEnvironment(
        "production",
        { ...production(), LOOMIS_SANDBOX_PASSWORD: "synthetic" },
        directory,
      ),
    /account settings/,
  );
  assert.throws(
    () =>
      loadEnvironment(
        "production",
        { ...production(), MOCK_CARRIERS: "true" },
        directory,
      ),
    /real carrier/,
  );
});
test("missing and mismatched database settings fail closed", () => {
  assert.throws(
    () =>
      loadEnvironment("sandbox", { ...sandbox(), DATABASE_URL: "" }, directory),
    /Missing DATABASE_URL/,
  );
  assert.throws(
    () =>
      loadEnvironment(
        "sandbox",
        { ...sandbox(), DATABASE_PROVIDER: "postgresql" },
        directory,
      ),
    /does not match/,
  );
});
test("deployment samples contain infrastructure settings but no carrier credentials", () => {
  for (const mode of ["local", "production"]) {
    const env = sample(mode);
    for (const key of [
      "APP_ENV",
      "APP_ORIGIN",
      "PORT",
      "DATABASE_PROVIDER",
      "DATABASE_URL",
      "POSTGRES_PASSWORD",
      "MOCK_CARRIERS",
      "CARRIER_TIMEOUT_MS",
    ])
      assert(key in env, key);
    assert(!Object.keys(env).some((key) => /^(CANADA_POST|FEDEX|LOOMIS)_/.test(key)));
  }
});
process.on("exit", () => rmSync(directory, { recursive: true, force: true }));
