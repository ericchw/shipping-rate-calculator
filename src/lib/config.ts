import "server-only";
import { z } from "zod";
import { AppError } from "./errors";
import type { User } from "./auth";
import { validCarrierUrl, requiredCredentialKeys } from "./carrier-settings-schema";
import { carrierIds } from "./schemas";
export type Mode = "sandbox" | "production";
export type Carrier = (typeof carrierIds)[number];
export type CarrierConfig = { base: string; get(name: string): string };
export function credentialsConfigured(carrier: Carrier, mode: Mode, c: CarrierConfig) {
  return !!c.base && ((carrier === "loomis" && mode === "production") || carrier === "purolator" ? validCarrierUrl(carrier, mode, c.base) : true)
    && requiredCredentialKeys(carrier, mode).every((key) => !!c.get(key));
}
export const flag = (key: string, fallback = false) =>
  process.env[key] === undefined ? fallback : process.env[key] === "true";
export function appEnvironment() {
  return z
    .enum(["development", "uat", "production"])
    .parse(process.env.APP_ENV ?? "development");
}
export function mockEnabled(mode?: Mode) {
  if (
    flag("MOCK_CARRIERS") &&
    appEnvironment() === "production"
  )
    throw new AppError(
      503,
      "CONFIGURATION_ERROR",
      "Mock mode is disabled in production",
    );
  return mode !== "production" && flag("MOCK_CARRIERS");
}
export function allowedModes(user?: User | null): Mode[] {
  return user ? [...(user.productionAccess !== false ? ["production" as const] : []), ...(user.uatAccess !== false ? ["sandbox" as const] : [])] : [];
}
export function carrierMode(): Mode {
  return "production";
}
export function assertMode(mode: Mode, user?: User | null) {
  if (!allowedModes(user).includes(mode))
    throw new AppError(403, "MODE_NOT_ALLOWED", "Carrier mode is not allowed");
}
export const baseUrls = {
  canada_post: {
    sandbox: "https://ct.soa-gw.canadapost.ca",
    production: "https://soa-gw.canadapost.ca",
  },
  purolator: {
    sandbox: "https://shipapi-sandbox.purolator.com",
    production: "https://shipapi.purolator.com",
  },
  fedex: {
    sandbox: "https://apis-sandbox.fedex.com",
    production: "https://apis.fedex.com",
  },
  loomis: {
    sandbox: "https://sandbox.loomis-express.com",
    production: "", // Supplied by the account in carrier settings.
  },
} as const;
export function carrierConfig(carrier: Carrier, mode: Mode) {
  const prefix = `${carrier === "canada_post" ? "CANADA_POST" : carrier.toUpperCase()}_${mode.toUpperCase()}_`;
  const get = (name: string) => process.env[prefix + name] ?? "";
  const base = carrier === "loomis" && mode === "production" ? get("BASE_URL") : baseUrls[carrier][mode];
  const configuredBase = get("BASE_URL");
  if (configuredBase && !validCarrierUrl(carrier, mode, configuredBase))
    throw new AppError(
      503,
      "CONFIGURATION_ERROR",
      "Carrier URL is not allowed",
    );
  return {
    carrier,
    mode,
    base,
    get,
  };
}
export function configured(carrier: Carrier, mode: Mode) {
  const c = carrierConfig(carrier, mode);
  if (mockEnabled()) return "configured";
  if (carrier === "loomis" || carrier === "purolator") return credentialsConfigured(carrier, mode, c) ? "configured" : "unconfigured";
  const keys =
    carrier === "canada_post"
      ? ["API_KEY", "API_SECRET"]
      : carrier === "fedex"
        ? ["CLIENT_ID", "CLIENT_SECRET", "ACCOUNT_NUMBER"]
        : ["USERNAME", "PASSWORD", "ACCOUNT_NUMBER", "RATING_WSDL_URL"];
  return keys.every((k) => c.get(k)) ? "configured" : "unconfigured";
}

export function validateConfiguration() {
  appEnvironment();
  mockEnabled();
  for (const key of [
    "MOCK_CARRIERS",
  ]) {
    if (process.env[key] !== undefined)
      z.enum(["true", "false"]).parse(process.env[key]);
  }
  if (appEnvironment() !== "development") {
    const origin = process.env.APP_ORIGIN;
    if (
      !origin ||
      !origin.startsWith("https://") ||
      new URL(origin).origin !== origin
    )
      throw new Error("APP_ORIGIN must be an exact HTTPS origin");
  }
}
