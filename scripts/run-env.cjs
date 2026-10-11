const { readFileSync, existsSync } = require("node:fs");
const { parseEnv } = require("node:util");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function loadEnvironment(
  mode,
  inherited = process.env,
  directory = process.cwd(),
) {
  if (mode === "sandbox") mode = "local"; // Compatibility for older maintenance commands.
  if (!["local", "production"].includes(mode))
    throw new Error("Select local or production deployment settings explicitly.");
  // These would otherwise be loaded a second time by Next.js. Keep one source.
  for (const name of [
    ".env",
    ".env.local",
    ".env.development",
    ".env.development.local",
    ".env.production",
    ".env.production.local",
    ".env.test",
    ".env.test.local",
  ]) {
    if (existsSync(path.join(directory, name)))
      throw new Error(
        `Legacy ${name} found. Move settings to env/${mode}.env; automatic env merging is disabled by this workflow.`,
      );
  }
  const file = path.join(directory, "env", `${mode}.env`);
  const values = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  // Runtime injected variables take precedence over the optional local file.
  const env = { ...values, ...inherited };
  for (const [key, value] of Object.entries(env)) {
    if (/^(CANADA_POST|FEDEX|LOOMIS)_/.test(key) && value)
      throw new Error("Carrier credentials and URLs belong in account settings, not environment files.");
    if (
      key.startsWith("NEXT_PUBLIC_") &&
      /(TOKEN|SECRET|PASSWORD|API_KEY|CLIENT_ID|ACCOUNT_NUMBER|DATABASE_URL)/.test(
        key,
      )
    )
      throw new Error("Credentials must not use NEXT_PUBLIC_ variables.");
  }
  for (const key of [
    "APP_ENV",
    "APP_ORIGIN",
    "DATABASE_PROVIDER",
    "DATABASE_URL",
  ]) {
    if (!env[key])
      throw new Error(
        `Missing ${key}; configure env/${mode}.env or inject it at runtime.`,
      );
  }
  if (mode === "local") {
    if (!["development", "uat"].includes(env.APP_ENV))
      throw new Error("Local APP_ENV must be development or uat.");
  } else {
    if (env.APP_ENV !== "production")
      throw new Error("Production APP_ENV must be production.");
    if (env.MOCK_CARRIERS !== "false")
      throw new Error("Production must use real carrier integrations.");
  }
  if (new URL(env.APP_ORIGIN).origin !== env.APP_ORIGIN)
    throw new Error("APP_ORIGIN must be an exact origin without a path or trailing slash.");
  if (env.APP_ENV !== "development" && !env.APP_ORIGIN.startsWith("https://"))
    throw new Error("Hosted production/UAT APP_ORIGIN must use HTTPS.");
  if (!["sqlite", "postgresql"].includes(env.DATABASE_PROVIDER))
    throw new Error("Unsupported DATABASE_PROVIDER.");
  if (
    env.DATABASE_PROVIDER === "sqlite"
      ? !env.DATABASE_URL.startsWith("file:")
      : !/^postgres(ql)?:\/\//.test(env.DATABASE_URL)
  )
    throw new Error("DATABASE_URL does not match DATABASE_PROVIDER.");
  return env;
}

if (require.main === module) {
  try {
    const [mode, tool, ...args] = process.argv.slice(2);
    const env = loadEnvironment(mode);
    if (tool === "check")
      console.log(
        `Environment valid: ${mode}; database: ${env.DATABASE_PROVIDER}. No secrets displayed.`,
      );
    else {
      let file;
      if (tool === "next") {
        file = require.resolve("next/dist/bin/next");
        env.NODE_ENV = args[0] === "dev" ? "development" : "production";
      } else if (tool === "tsx") file = require.resolve("tsx/cli");
      else if (tool === "node") file = path.resolve(args.shift());
      else throw new Error("Unsupported environment command.");
      const result = spawnSync(process.execPath, [file, ...args], {
        env,
        stdio: "inherit",
        windowsHide: true,
      });
      if (result.error)
        throw new Error(
          "Could not start command. Check dependencies and process permissions.",
        );
      process.exitCode = result.status ?? 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { loadEnvironment };
