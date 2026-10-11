import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../src/lib/db";
import * as database from "../src/lib/db";
import * as settingsModule from "../src/lib/carrier-settings";
import { login, passwordHash } from "../src/lib/auth";
import { GET, POST, PUT } from "../src/app/api/v1/[...path]/route";
import { defaultCarrierUrl } from "../src/lib/carrier-settings-schema";
let store: Store, cookie: string, directory: string;
const origin = "http://localhost:3000";
const owner = randomUUID();
beforeEach(async () => {
  vi.stubEnv("APP_ORIGIN", origin); vi.stubEnv("APP_ENV", "development"); vi.stubEnv("MOCK_CARRIERS", "false");
  store = new Store("sqlite", "file::memory:"); await store.migrate();
  vi.spyOn(database, "db").mockReturnValue(store);
  directory = mkdtempSync(path.join(tmpdir(), "routed-api-"));
  const settings = new settingsModule.CarrierSettings(store, path.join(directory, "key"));
  vi.spyOn(settingsModule, "CarrierSettings").mockImplementation(() => settings);
  await store.query("INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)", [owner, `${owner}@example.test`, await passwordHash("test-password"), "user", new Date().toISOString()]);
  cookie = `shipping_session=${(await login(`${owner}@example.test`, "test-password")).token}`;
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); await store.close(); rmSync(directory, { recursive: true, force: true }); });
async function call(area: string, route: string, method = "GET", value?: unknown, session = cookie) {
  const handler = method === "GET" ? GET : method === "PUT" ? PUT : POST;
  const request = new Request(`${origin}${area}/api/v1/${route}`, { method, headers: { Origin: origin, Cookie: session, ...(value === undefined ? {} : { "Content-Type": "application/json" }) }, body: value === undefined ? undefined : JSON.stringify(value) });
  const response = await handler(request, { params: Promise.resolve({ path: route.split("?")[0].split("/") }) });
  return { status: response.status, data: await response.json() };
}
describe("routed credentials and connections", () => {
  it("saves and tests production Loomis through the account's supplied endpoint", async () => {
    const endpoint = "https://www.loomis-express.com/axis2/services/USSRatingService.USSRatingServiceHttpsSoap11Endpoint/";
    const saved = await call("", "carrier-settings/production/loomis", "PUT", { enabled: true, baseUrl: endpoint, fields: { USERNAME: "production-user", PASSWORD: "production-secret", ACCOUNT_NUMBER: "production-account" } });
    expect(saved.status).toBe(200); expect(saved.data.configured).toBe(true);
    const fetchMock = vi.fn().mockResolvedValue(new Response('<Envelope><Body><getRatesResponse><return><getRatesResult><shipment><service_type>DD</service_type><shipment_info_num><name>TOTAL_CHARGE</name><value>37.50</value></shipment_info_num></shipment></getRatesResult></return></getRatesResponse></Body></Envelope>'));
    vi.stubGlobal("fetch", fetchMock);
    const checked = await call("", "carrier-settings/production/loomis/test", "POST");
    expect(checked.status).toBe(200); expect(checked.data.status).toBe("success");
    expect(fetchMock.mock.calls[0][0]).toBe(endpoint);
    expect(fetchMock.mock.calls[0][1].body).toContain("production-account");
    expect(JSON.stringify(checked.data)).not.toContain("production-secret");
    expect((await call("/sandbox", "carrier-settings")).data.settings.find((setting: { carrier: string }) => setting.carrier === "loomis").configured).toBe(false);
  });
  it("reports the area mode and requires a valid session", async () => {
    expect((await call("", "auth/session")).data.mode).toBe("production");
    expect((await call("/sandbox", "auth/session")).data.mode).toBe("sandbox");
    expect((await call("", "carrier-settings", "GET", undefined, "")).status).toBe(401);
    await store.query("UPDATE sessions SET expires_at=?", ["2000-01-01T00:00:00.000Z"]);
    expect((await call("/sandbox", "carrier-settings")).status).toBe(401);
    expect((await call("/sandbox", "auth/session")).data.user).toBeNull();
  });
  it("rejects cross-environment settings, rates and connection checks before making a carrier call", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await call("/sandbox", "carrier-settings/production/fedex", "PUT", { enabled: false, baseUrl: defaultCarrierUrl("fedex", "production"), fields: {} })).status).toBe(400);
    expect((await call("", "carrier-settings?mode=sandbox")).status).toBe(400);
    expect((await call("/sandbox", "carrier-settings/production/fedex/test", "POST")).status).toBe(400);
    const shipment = { ship_from: { city: "Vancouver", region: "BC", postal_code: "V6B1A1", country_code: "CA" }, ship_to: { city: "Toronto", region: "ON", postal_code: "M5V2T6", country_code: "CA" }, shipDate: "2026-10-13", packages: [{ length: 12, width: 8, height: 6, dimensionUnit: "in", weight: 5, weightUnit: "lb" }], carriers: ["fedex"], carrierMode: "production" };
    expect((await call("/sandbox", "rates", "POST", shipment)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("tests saved credentials even when disabled, reports real API errors safely and keeps production separate", async () => {
    const saved = await call("/sandbox", "carrier-settings/sandbox/canada_post", "PUT", { enabled: false, baseUrl: defaultCarrierUrl("canada_post", "sandbox"), fields: { API_KEY: "account-api-key", API_SECRET: "account-api-secret" }, quoteType: "counter" });
    expect(saved.status).toBe(200); expect(saved.data.fields.API_SECRET).toBeUndefined();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('<price-quotes><price-quote><service-code>DOM.XP</service-code><service-name>Xpresspost</service-name><price-details><base>20</base><due>22.40</due></price-details></price-quote></price-quotes>'))
      .mockResolvedValueOnce(new Response('<messages><message><code>AA004</code><description>private response</description></message></messages>', { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const success = await call("/sandbox", "carrier-settings/sandbox/canada_post/test", "POST");
    expect(success.data.status).toBe("success");
    expect(fetchMock.mock.calls[0][0]).toBe("https://ct.soa-gw.canadapost.ca/rs/ship/price");
    expect((await call("/sandbox", "carrier-settings/sandbox/canada_post/test", "POST")).data).toMatchObject({ status: "error", message: "Rate request failed (HTTP 403; AA004)." });
    const production = await call("", "carrier-settings/production/canada_post/test", "POST");
    expect(production.data.status).toBe("unconfigured");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(success)).not.toContain("account-api-secret");
  });
});
