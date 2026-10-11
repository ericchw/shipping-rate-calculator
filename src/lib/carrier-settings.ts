import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db, type Store, type Connection } from "./db";
import { AppError } from "./errors";
import { carrierDefinitions, carrierSettingsInput, defaultCarrierUrl, validCarrierUrl, type SettingsCarrier, type SettingsMode, type PublicCarrierSettings } from "./carrier-settings-schema";
import type { CarrierConfig } from "./config";

type StoredSettings = { baseUrl: string; fields: Record<string, string>; quoteType: "counter" | "commercial" };
type SettingsRow = { enabled: number; encrypted_settings: string };
export class CarrierSettings {
  constructor(private store: Store = db(), private keyFile = path.resolve("data/carrier-settings.key")) {}
  private key() {
    mkdirSync(path.dirname(this.keyFile), { recursive: true });
    try { writeFileSync(this.keyFile, randomBytes(32), { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const key = readFileSync(this.keyFile);
    if (key.length !== 32) throw new Error("Invalid carrier settings encryption key");
    return key;
  }
  private context(owner: string, carrier: SettingsCarrier, mode: SettingsMode) { return Buffer.from(`${owner}:${carrier}:${mode}`); }
  private encrypt(value: StoredSettings, owner: string, carrier: SettingsCarrier, mode: SettingsMode) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(this.context(owner, carrier, mode));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
  }
  private decrypt(text: string, owner: string, carrier: SettingsCarrier, mode: SettingsMode): StoredSettings {
    const data = Buffer.from(text, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key(), data.subarray(0, 12));
    decipher.setAAD(this.context(owner, carrier, mode));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8"));
  }
  private defaults(carrier: SettingsCarrier, mode: SettingsMode): StoredSettings {
    return { baseUrl: defaultCarrierUrl(carrier, mode), fields: {}, quoteType: mode === "sandbox" ? "counter" : "commercial" };
  }
  private async read(owner: string, carrier: SettingsCarrier, mode: SettingsMode, connection: Connection = this.store) {
    const row = (await connection.query<SettingsRow>("SELECT enabled,encrypted_settings FROM carrier_settings WHERE user_id=? AND carrier=? AND mode=?", [owner, carrier, mode]))[0];
    return { enabled: !!row?.enabled, value: row ? this.decrypt(row.encrypted_settings, owner, carrier, mode) : this.defaults(carrier, mode) };
  }
  private ready(carrier: SettingsCarrier, mode: SettingsMode, value: StoredSettings) {
    const required = carrier === "canada_post" ? ["API_KEY", "API_SECRET"] : carrier === "fedex" ? ["CLIENT_ID", "CLIENT_SECRET", "ACCOUNT_NUMBER"] : ["USERNAME", "PASSWORD", "ACCOUNT_NUMBER"];
    return validCarrierUrl(carrier, mode, value.baseUrl) && required.every((key) => !!value.fields[key]);
  }
  async get(owner: string, carrier: SettingsCarrier, mode: SettingsMode): Promise<PublicCarrierSettings> {
    const { enabled, value } = await this.read(owner, carrier, mode);
    const fields: Record<string, string> = {}, savedSecrets: Record<string, boolean> = {};
    for (const field of carrierDefinitions[carrier].fields) {
      if (field.secret) savedSecrets[field.key] = !!value.fields[field.key];
      else fields[field.key] = value.fields[field.key] ?? "";
    }
    return { carrier, mode, enabled, baseUrl: value.baseUrl, fields, savedSecrets, quoteType: value.quoteType, configured: this.ready(carrier, mode, value) };
  }
  async save(owner: string, carrier: SettingsCarrier, mode: SettingsMode, input: unknown) {
    const parsed = carrierSettingsInput.parse(input);
    const allowed = new Set<string>(carrierDefinitions[carrier].fields.map((field) => field.key));
    if (Object.keys(parsed.fields).some((field) => !allowed.has(field))) throw new AppError(400, "INVALID_FIELD", "Unexpected credential field");
    // Only carrier-owned endpoints can receive credentials. Redirects are also disabled by transport.
    const expected = defaultCarrierUrl(carrier, mode);
    if (!(carrier === "loomis" && mode === "production" && !parsed.enabled && !parsed.baseUrl) && !validCarrierUrl(carrier, mode, parsed.baseUrl))
      throw new AppError(400, "INVALID_CARRIER_URL", carrier === "loomis" && mode === "production"
        ? "Enter the official Loomis production HTTPS SOAP rating endpoint, without ?wsdl. Sandbox URLs cannot be used in production."
        : `Use the official ${mode} URL: ${expected}`);
    await this.store.transaction(async (tx) => {
      await tx.query("UPDATE users SET id=id WHERE id=?", [owner]);
      const current = await this.read(owner, carrier, mode, tx);
      const fields: Record<string, string> = parsed.clearCredentials ? {} : { ...current.value.fields };
      for (const field of carrierDefinitions[carrier].fields) {
        if (parsed.fields[field.key] !== undefined && (!field.secret || parsed.fields[field.key] !== "")) fields[field.key] = parsed.fields[field.key];
      }
      const value = { baseUrl: parsed.baseUrl, fields, quoteType: parsed.quoteType ?? current.value.quoteType };
      if (parsed.enabled && !this.ready(carrier, mode, value)) throw new AppError(400, "CREDENTIALS_REQUIRED", "Fill in the required API URL and credentials before enabling this carrier.");
      await tx.query("INSERT INTO carrier_settings (user_id,carrier,mode,enabled,encrypted_settings,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT (user_id,carrier,mode) DO UPDATE SET enabled=excluded.enabled,encrypted_settings=excluded.encrypted_settings,updated_at=excluded.updated_at",
        [owner, carrier, mode, Number(parsed.enabled), this.encrypt(value, owner, carrier, mode), new Date().toISOString()]);
    });
    return this.get(owner, carrier, mode);
  }
  async delete(owner: string, carrier: SettingsCarrier, mode: SettingsMode) {
    await this.store.query("DELETE FROM carrier_settings WHERE user_id=? AND carrier=? AND mode=?", [owner, carrier, mode]);
  }
  async config(owner: string, carrier: SettingsCarrier, mode: SettingsMode): Promise<CarrierConfig & { enabled: boolean }> {
    const { enabled, value } = await this.read(owner, carrier, mode);
    return { enabled, base: value.baseUrl, get: (key) => key === "QUOTE_TYPE" ? value.quoteType : value.fields[key] ?? "" };
  }
}
