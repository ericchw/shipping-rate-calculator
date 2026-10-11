import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../src/lib/db";
import * as database from "../src/lib/db";
import { CarrierSettings } from "../src/lib/carrier-settings";
import { defaultCarrierUrl } from "../src/lib/carrier-settings-schema";
import { compare } from "../src/lib/quote-service";
import { shipmentSchema } from "../src/lib/schemas";

let store: Store, settings: CarrierSettings, directory: string;
const owner = randomUUID(), other = randomUUID();
const credentials = { enabled: true, baseUrl: defaultCarrierUrl("fedex", "sandbox"), fields: { CLIENT_ID: "private-api-key", CLIENT_SECRET: "private-secret", ACCOUNT_NUMBER: "account-a" } };
beforeEach(async () => {
  store = new Store("sqlite", "file::memory:");
  await store.migrate();
  directory = mkdtempSync(path.join(tmpdir(), "carrier-settings-"));
  settings = new CarrierSettings(store, path.join(directory, "key"));
  for (const id of [owner, other]) await store.query("INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)", [id, `${id}@example.test`, "test-hash", "user", new Date().toISOString()]);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); await store.close(); rmSync(directory, { recursive: true, force: true }); });
describe("account carrier settings", () => {
  it("encrypts credentials, masks secret responses and isolates accounts and modes", async () => {
    const saved = await settings.save(owner, "fedex", "sandbox", credentials);
    expect(saved.savedSecrets).toEqual({ CLIENT_ID: true, CLIENT_SECRET: true });
    expect(saved.fields).toEqual({ ACCOUNT_NUMBER: "account-a" });
    expect(JSON.stringify(saved)).not.toContain("private-");
    const rows = await store.query<{ encrypted_settings: string }>("SELECT encrypted_settings FROM carrier_settings");
    expect(rows[0].encrypted_settings).not.toContain("private-");
    expect(Buffer.from(rows[0].encrypted_settings, "base64").toString()).not.toContain("private-");
    expect((await settings.config(owner, "fedex", "sandbox")).get("CLIENT_SECRET")).toBe("private-secret");
    expect((await settings.get(other, "fedex", "sandbox")).enabled).toBe(false);
    expect((await settings.get(owner, "fedex", "production")).savedSecrets.CLIENT_SECRET).toBe(false);
    expect(readFileSync(path.join(directory, "key"))).toHaveLength(32);
    expect(statSync(path.join(directory, "key")).mode & 0o777).toBe(0o600);
  });
  it("preserves blank secrets, updates account fields, disables and clears only the owner", async () => {
    await settings.save(owner, "fedex", "sandbox", credentials);
    await settings.save(owner, "fedex", "sandbox", { ...credentials, enabled: false, fields: { CLIENT_ID: "", CLIENT_SECRET: "", ACCOUNT_NUMBER: "updated" } });
    const config = await settings.config(owner, "fedex", "sandbox");
    expect(config.enabled).toBe(false);
    expect(config.get("CLIENT_ID")).toBe("private-api-key");
    expect(config.get("ACCOUNT_NUMBER")).toBe("updated");
    await settings.delete(other, "fedex", "sandbox");
    expect((await settings.get(owner, "fedex", "sandbox")).configured).toBe(true);
    await settings.delete(owner, "fedex", "sandbox");
    expect((await settings.get(owner, "fedex", "sandbox")).configured).toBe(false);
  });
  it("rejects foreign URLs, wrong-mode URLs, unknown fields and incomplete enabled credentials", async () => {
    for (const baseUrl of ["https://example.test", "http://127.0.0.1", "https://apis-sandbox.fedex.com.evil.test", defaultCarrierUrl("fedex", "production")])
      await expect(settings.save(owner, "fedex", "sandbox", { ...credentials, baseUrl })).rejects.toThrow("official");
    await expect(settings.save(owner, "fedex", "sandbox", { ...credentials, fields: { CLIENT_ID: "only-key" } })).rejects.toMatchObject({ code: "CREDENTIALS_REQUIRED" });
    await expect(settings.save(owner, "fedex", "sandbox", { ...credentials, fields: { ...credentials.fields, PASSWORD: "bad-field" } })).rejects.toThrow("Unexpected");
    expect(await store.query("SELECT * FROM carrier_settings")).toHaveLength(0);
  });
  it("binds ciphertext to its account and mode", async () => {
    await settings.save(owner, "fedex", "sandbox", credentials);
    const row = (await store.query<{ encrypted_settings: string }>("SELECT encrypted_settings FROM carrier_settings"))[0];
    await store.query("INSERT INTO carrier_settings (user_id,carrier,mode,enabled,encrypted_settings,updated_at) VALUES (?,?,?,?,?,?)", [other, "fedex", "sandbox", 1, row.encrypted_settings, new Date().toISOString()]);
    await expect(settings.config(other, "fedex", "sandbox")).rejects.toThrow();
  });
  it("uses saved credentials for quoting and never falls back to environment credentials when disabled", async () => {
    await settings.save(owner, "fedex", "sandbox", credentials);
    const resolveConfig = settings.config.bind(settings);
    vi.spyOn(database, "db").mockReturnValue(store);
    vi.spyOn(CarrierSettings.prototype, "config").mockImplementation(resolveConfig);
    vi.stubEnv("MOCK_CARRIERS", "false");
    vi.stubEnv("FEDEX_SANDBOX_CLIENT_SECRET", "wrong-env-secret");
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "test-access-token", expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: { rateReplyDetails: [{ serviceType: "GROUND", ratedShipmentDetails: [{ rateType: "ACCOUNT", currency: "CAD", totalNetCharge: 25 }] }] } })));
    vi.stubGlobal("fetch", fetchMock);
    const shipment = shipmentSchema.parse({ ship_from: { city: "Vancouver", region: "BC", postal_code: "V6B1A1", country_code: "CA" }, ship_to: { city: "Toronto", region: "ON", postal_code: "M5V2T6", country_code: "CA" }, shipDate: "2026-10-13", packages: [{ length: 12, width: 8, height: 6, dimensionUnit: "in", weight: 5, weightUnit: "lb" }], carriers: ["fedex"], coverageAmount: 0 });
    const disabled = await compare(shipment, other);
    expect(disabled.carrierStatuses[0].status).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
    const quoted = await compare(shipment, owner);
    expect(quoted.carrierStatuses[0].status).toBe("success");
    expect(fetchMock.mock.calls[0][1].body).toContain("private-secret");
    expect(fetchMock.mock.calls[0][1].body).not.toContain("wrong-env-secret");
    expect(quoted.results[0].withoutCoverage.total).toBe("25.00");
  });
});

 describe("Loomis production settings", () => {
  const endpoint = "https://www.loomis-express.com/axis2/services/USSRatingService.USSRatingServiceHttpsSoap11Endpoint/";
  const fields = { USERNAME: "production-user", PASSWORD: "production-secret", ACCOUNT_NUMBER: "production-account" };
  it("accepts account-entered official endpoints and isolates production from sandbox", async () => {
    const saved = await settings.save(owner, "loomis", "production", { enabled: true, baseUrl: endpoint, fields });
    expect(saved.configured).toBe(true); expect(saved.enabled).toBe(true);
    expect(saved.savedSecrets.PASSWORD).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("production-secret");
    const config = await settings.config(owner, "loomis", "production");
    expect(config.base).toBe(endpoint); expect(config.get("PASSWORD")).toBe("production-secret");
    expect((await settings.get(owner, "loomis", "sandbox")).configured).toBe(false);
    expect((await settings.get(other, "loomis", "production")).configured).toBe(false);
  });
  it("rejects sandbox, foreign, non-HTTPS and WSDL URLs and incomplete credentials", async () => {
    for (const baseUrl of [defaultCarrierUrl("loomis", "sandbox"), "https://evil.test/rate", "https://loomis-express.com.evil.test/rate", "http://www.loomis-express.com/rate", "https://127.0.0.1/rate", endpoint + "?wsdl", "https://user:pass@www.loomis-express.com/rate", endpoint + "#fragment", "https://www.loomis-express.com:8443/rate"])
      await expect(settings.save(owner, "loomis", "production", { enabled: true, baseUrl, fields })).rejects.toMatchObject({ code: "INVALID_CARRIER_URL" });
    await expect(settings.save(owner, "loomis", "production", { enabled: true, baseUrl: endpoint, fields: { USERNAME: "user" } })).rejects.toMatchObject({ code: "CREDENTIALS_REQUIRED" });
    expect(await store.query("SELECT * FROM carrier_settings")).toHaveLength(0);
  });
 });

it("clears saved secrets only on explicit save and supports replacing cleared credentials", async () => {
  await settings.save(owner, "fedex", "sandbox", credentials);
  // A local clear operation does not call the server; a reload retains saved settings.
  expect((await settings.get(owner, "fedex", "sandbox")).configured).toBe(true);
  const cleared = await settings.save(owner, "fedex", "sandbox", { enabled: false, baseUrl: credentials.baseUrl, fields: {}, clearCredentials: true });
  expect(cleared.enabled).toBe(false); expect(cleared.configured).toBe(false);
  expect(cleared.savedSecrets).toEqual({ CLIENT_ID: false, CLIENT_SECRET: false });
  expect((await settings.config(owner, "fedex", "sandbox")).get("CLIENT_SECRET")).toBe("");
  await settings.save(owner, "fedex", "sandbox", credentials);
  await settings.save(owner, "fedex", "sandbox", { ...credentials, fields: { CLIENT_ID: "replacement-key", CLIENT_SECRET: "replacement-secret", ACCOUNT_NUMBER: "replacement-account" }, clearCredentials: true });
  expect((await settings.config(owner, "fedex", "sandbox")).get("CLIENT_SECRET")).toBe("replacement-secret");
});
