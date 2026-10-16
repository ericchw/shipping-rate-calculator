import { z } from "zod";
import { carrierIds } from "./schemas";

export const settingsModes = ["sandbox", "production"] as const;
export const carrierDefinitions = {
  canada_post: { name: "Canada Post", fields: [
    { key: "API_KEY", label: "API key / username", secret: true },
    { key: "API_SECRET", label: "API secret / password", secret: true },
    { key: "CUSTOMER_NUMBER", label: "Customer / account ID", secret: false },
    { key: "CONTRACT_ID", label: "Contract ID", secret: false },
  ] },
  fedex: { name: "FedEx", fields: [
    { key: "CLIENT_ID", label: "API key / client ID", secret: true },
    { key: "CLIENT_SECRET", label: "Secret key / client secret", secret: true },
    { key: "ACCOUNT_NUMBER", label: "Account ID", secret: false },
  ] },
  purolator: { name: "Purolator", fields: [
    { key: "CLIENT_ID", label: "Client ID / key", secret: true },
    { key: "CLIENT_SECRET", label: "Client secret / password", secret: true },
    { key: "API_KEY", label: "REST API key (x-api-key)", secret: true },
    { key: "SENDER_ACCOUNT", label: "Sender account", secret: false },
    { key: "RECEIVER_ACCOUNT", label: "Receiver account (optional)", secret: false },
    { key: "FREIGHT_ACCOUNT", label: "Freight account (optional)", secret: false },
  ] },
  loomis: { name: "Loomis Express", fields: [
    { key: "USERNAME", label: "Username", secret: false },
    { key: "PASSWORD", label: "Password", secret: true },
    { key: "ACCOUNT_NUMBER", label: "Account ID", secret: false },
  ] },
} as const;
export type SettingsCarrier = typeof carrierIds[number];
export type SettingsMode = typeof settingsModes[number];
export function defaultCarrierUrl(carrier: SettingsCarrier, mode: SettingsMode) {
  if (carrier === "canada_post") return mode === "sandbox" ? "https://ct.soa-gw.canadapost.ca" : "https://soa-gw.canadapost.ca";
  if (carrier === "purolator") return mode === "sandbox" ? "https://shipapi-sandbox.purolator.com" : "https://shipapi.purolator.com";
  if (carrier === "fedex") return mode === "sandbox" ? "https://apis-sandbox.fedex.com" : "https://apis.fedex.com";
  return mode === "sandbox" ? "https://sandbox.loomis-express.com/axis2/services/USSRatingService.USSRatingServiceHttpsSoap11Endpoint/" : "";
}
export function validCarrierUrl(carrier: SettingsCarrier, mode: SettingsMode, value: string) {
  if (carrier !== "loomis" || mode !== "production") return value === defaultCarrierUrl(carrier, mode);
  try {
    const url = new URL(value);
    const official = ["loomis-express.com", "loomisexpress.com"].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    return url.protocol === "https:" && official && !url.username && !url.password && !url.port && !url.search && !url.hash
      && url.pathname !== "/" && !/\.(?:wsdl)$/i.test(url.pathname)
      && !/(^|[.-])(sandbox|uat|test)([.-]|$)/i.test(url.hostname);
  } catch { return false; }
}
export const carrierSettingsInput = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().trim().max(500),
  fields: z.record(z.string().max(40), z.string().max(1024)),
  quoteType: z.enum(["counter", "commercial"]).optional(),
  clearCredentials: z.boolean().optional(),
}).strict();
export type PublicCarrierSettings = {
  carrier: SettingsCarrier;
  mode: SettingsMode;
  enabled: boolean;
  baseUrl: string;
  fields: Record<string, string>;
  savedSecrets: Record<string, boolean>;
  quoteType: "counter" | "commercial";
  configured: boolean;
};

export function requiredCredentialKeys(carrier: SettingsCarrier, mode: SettingsMode): string[] {
  if (carrier === "canada_post") return ["API_KEY", "API_SECRET"];
  if (carrier === "fedex") return ["CLIENT_ID", "CLIENT_SECRET", "ACCOUNT_NUMBER"];
  if (carrier === "purolator") return [...(mode === "production" ? ["API_KEY"] : []), "CLIENT_ID", "CLIENT_SECRET", "SENDER_ACCOUNT"];
  return ["USERNAME", "PASSWORD", "ACCOUNT_NUMBER"];
}
