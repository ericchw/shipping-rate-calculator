import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../src/lib/db";
import * as database from "../src/lib/db";
import * as settingsModule from "../src/lib/carrier-settings";
import { login, passwordHash } from "../src/lib/auth";
import { GET, POST, PUT, DELETE } from "../src/app/api/v1/[...path]/route";
import { defaultCarrierUrl } from "../src/lib/carrier-settings-schema";
let store: Store, cookie: string, directory: string;
const origin = "http://localhost:3000";
let owner: string;
beforeEach(async () => {
  owner = randomUUID();
  vi.stubEnv("APP_ORIGIN", origin); vi.stubEnv("APP_ENV", "development"); vi.stubEnv("MOCK_CARRIERS", "false");
  store = new Store("sqlite", "file::memory:"); await store.migrate();
  vi.spyOn(database, "db").mockReturnValue(store);
  directory = mkdtempSync(path.join(tmpdir(), "routed-api-"));
  const settings = new settingsModule.CarrierSettings(store, path.join(directory, "key"));
  vi.spyOn(settingsModule, "CarrierSettings").mockImplementation(() => settings);
  await store.query("INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)", [owner, `${owner}@example.test`, await passwordHash("test-password"), "admin", new Date().toISOString()]);
  await store.query("INSERT INTO company_groups(id,name,created_at) VALUES (?,?,?)", [owner, "Test company", new Date().toISOString()]);
  await store.query("INSERT INTO group_memberships(user_id,group_id) VALUES (?,?)", [owner, owner]);
  cookie = `shipping_session=${(await login(`${owner}@example.test`, "test-password", "web")).token}`;
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); await store.close(); rmSync(directory, { recursive: true, force: true }); });
async function call(area: string, route: string, method = "GET", value?: unknown, session = cookie) {
  const handler = method === "GET" ? GET : method === "PUT" ? PUT : method === "DELETE" ? DELETE : POST;
  const request = new Request(`${origin}${area}/api/v1/${route}`, { method, headers: { Origin: origin, Cookie: session, ...(value === undefined ? {} : { "Content-Type": "application/json" }) }, body: value === undefined ? undefined : JSON.stringify(value) });
  const response = await handler(request, { params: Promise.resolve({ path: route.split("?")[0].split("/") }) });
  return { status: response.status, data: response.status === 204 ? null : await response.json() };
}
describe("routed credentials and connections", () => {
  it("enforces environment grants for both Web and API sessions across data and settings routes", async () => {
    await store.query("INSERT INTO account_environment_access VALUES (?,?,?)", [owner, 0, 1]);
    for (const channel of ["web", "api"] as const) {
      const token = (await login(owner + "@example.test", "test-password", channel)).token;
      const session = "shipping_session=" + token;
      expect((await call("", "auth/session", "GET", undefined, session)).data.modes).toEqual(["sandbox"]);
      for (const route of ["carriers", "profiles", "labels", "rate-logs", "carrier-settings", "admin/accounts"]) {
        expect((await call("", route, "GET", undefined, session)).status).toBe(403);
      }
      expect((await call("/sandbox", "carriers", "GET", undefined, session)).status).toBe(200);
    }
    await store.query("UPDATE account_environment_access SET production_access=1,uat_access=0 WHERE user_id=?", [owner]);
    expect((await call("/sandbox", "carriers")).status).toBe(403);
    expect((await call("", "carriers")).status).toBe(200);
    await store.migrate();
    expect((await call("/sandbox", "carriers")).status).toBe(403);
  });
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

it("saves generated sandbox labels and exposes list/detail without a second carrier call", async () => {
  await store.query("INSERT INTO group_generation_settings(group_id,mode,enabled) VALUES (?,?,?)", [owner, "sandbox", 1]);
  await call("/sandbox", "carrier-settings/sandbox/loomis", "PUT", { enabled: true, baseUrl: defaultCarrierUrl("loomis", "sandbox"), fields: { USERNAME: "sandbox-user", PASSWORD: "sandbox-secret", ACCOUNT_NUMBER: "sandbox-account" } });
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response('<Envelope><Body><processShipmentResponse><return><processShipmentResult><shipment><id>1234</id><shipment_info_str><name>SIN</name><value>TEST1234</value></shipment_info_str></shipment></processShipmentResult></return></processShipmentResponse></Body></Envelope>')).mockResolvedValueOnce(new Response(`<Envelope><Body><getLabelsAdvancedV2Response><return><result><label>${png}</label></result></return></getLabelsAdvancedV2Response></Body></Envelope>`));
  vi.stubGlobal("fetch", fetchMock);
  const shipment = { ship_from: { city: "Vancouver", region: "BC", postal_code: "V6B1A1" }, ship_to: { city: "Toronto", region: "ON", postal_code: "M5V2T6" }, shipDate: "2026-10-14", packages: [{ length: 12, width: 8, height: 6, dimensionUnit: "in", weight: 5, weightUnit: "lb" }], carrierMode: "sandbox" };
  const created = await call("/sandbox", "loomis/labels", "POST", { shipment, serviceCode: "DD" });
  expect(created.status).toBe(201);
  const listed = await call("/sandbox", "labels");
  expect(listed.data.labels[0]).toMatchObject({ id: created.data.id, shipment_number: "TEST1234" });
  expect(listed.data).toMatchObject({ total: 1, page: 1, pageSize: 20, totalPages: 1 });
  expect((await call("/sandbox", "labels?page=99&pageSize=10")).data).toMatchObject({ page: 1, pageSize: 10, total: 1 });
  expect((await call("/sandbox", "labels?page=0")).status).toBe(400);
  expect((await call("/sandbox", "labels?pageSize=999")).status).toBe(400);
  const detail = await call("/sandbox", `labels/${created.data.id}`);
  expect(detail.data.labels).toEqual([png]);
  expect(detail.data.shipment.ship_from.address_line1).toBe("1 Test Street");
  expect(JSON.stringify(detail.data)).not.toContain("sandbox-secret");
  expect((await call("", `labels/${created.data.id}`)).status).toBe(404);
  expect((await call("/sandbox", `labels/${created.data.id}`, "GET", undefined, "")).status).toBe(401);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("requires a session for postal suggestions and validates complete postal codes", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ "country abbreviation": "CA", "post code": "L4N", places: [{ "place name": "Barrie", "state abbreviation": "ON" }] })));
  vi.stubGlobal("fetch", fetchMock);
  expect((await call("/sandbox", "postal-suggestions?country=CA&postalCode=L4N9R3", "GET", undefined, "")).status).toBe(401);
  expect((await call("/sandbox", "postal-suggestions?country=CA&postalCode=L4N")).status).toBe(400);
  const response = await call("/sandbox", "postal-suggestions?country=CA&postalCode=L4N9R3");
  expect(response.data).toMatchObject({ lookupCode: "L4N", precision: "area", suggestions: [{ city: "Barrie", region: "ON" }] });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

 it("defaults generation off, denies non-admin management and blocks carrier calls", async () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  await store.query("UPDATE users SET role='user' WHERE id=?", [owner]);
  expect((await call("/sandbox", "auth/session")).data.generationEnabled).toBe(false);
  expect((await call("/sandbox", "admin/generation-settings")).status).toBe(403);
  expect((await call("/sandbox", "admin/generation-settings", "PUT", { enabled: true })).status).toBe(403);
  await store.query("UPDATE users SET role='operator' WHERE id=?", [owner]);
  expect((await call("/sandbox", "admin/generation-settings", "PUT", { enabled: true })).status).toBe(403);
  const blocked = await call("/sandbox", "loomis/labels", "POST", { enabled: true });
  expect(blocked.status).toBe(403);
  expect(blocked.data.error.code).toBe("GENERATION_DISABLED");
  expect(fetchMock).not.toHaveBeenCalled();
});
 it("allows only web admins to manage generation independently per environment", async () => {
  cookie = `shipping_session=${(await login(`${owner}@example.test`, "test-password", "api")).token}`;
  expect((await call("/sandbox", "admin/generation-settings", "PUT", { enabled: true })).status).toBe(403);
  cookie = `shipping_session=${(await login(`${owner}@example.test`, "test-password", "web")).token}`;
  expect((await call("/sandbox", "admin/generation-settings")).data.enabled).toBe(false);
  expect((await call("/sandbox", "admin/generation-settings", "PUT", { enabled: "true" })).status).toBe(400);
  expect((await call("/sandbox", "admin/generation-settings", "PUT", { enabled: true })).data.enabled).toBe(true);
  expect((await call("/sandbox", "auth/session")).data.generationEnabled).toBe(true);
  expect((await call("", "auth/session")).data.generationEnabled).toBe(false);
  expect((await call("/sandbox", "admin/generation-settings", "PUT", { enabled: false })).data.enabled).toBe(false);
  await store.query("UPDATE users SET role='user' WHERE id=?", [owner]);
  expect((await call("/sandbox", "admin/generation-settings", "PUT", { enabled: true })).status).toBe(403);
});

it("records a multi-carrier comparison once, exposes saved details and rejects foreign groups", async () => {
  vi.stubEnv("MOCK_CARRIERS", "true");
  for (const carrier of ["loomis", "fedex"] as const) await call("/sandbox", `carrier-settings/sandbox/${carrier}`, "PUT", { enabled: true, baseUrl: defaultCarrierUrl(carrier,"sandbox"), fields: carrier === "loomis" ? { USERNAME:"fixture",PASSWORD:"secret",ACCOUNT_NUMBER:"account" } : { CLIENT_ID:"fixture",CLIENT_SECRET:"secret",ACCOUNT_NUMBER:"account" } });
  const comparisonId=randomUUID();
  const shipment={ ship_from:{city:"Richmond",region:"BC",postal_code:"V6V2K9"},ship_to:{city:"Toronto",region:"ON",postal_code:"M5V2T6"},shipDate:"2026-01-01",packages:[{weight:5,weightUnit:"lb",length:0,width:0,height:0,dimensionUnit:"in"}],carrierMode:"sandbox" };
  const replies=await Promise.all(["loomis","fedex"].map(carrier=>call("/sandbox","rates","POST",{...shipment,carriers:[carrier],comparisonId,comparisonCarriers:["loomis","fedex"]})));
  expect(replies.map(reply=>reply.status)).toEqual([200,200]);
  expect(replies.every(reply=>reply.data.quoteLogId===comparisonId)).toBe(true);
  const listed=await call("/sandbox","rate-logs"); expect(listed.data.total).toBe(1);
  expect(listed.data.logs[0].status).toBe("completed");
  expect((await call("/sandbox",`rate-logs/${comparisonId}`)).data.shipment.carriers).toEqual(["loomis","fedex"]);
  expect((await call("",`rate-logs/${comparisonId}`)).status).toBe(404);
  expect((await call("/sandbox","rate-logs?pageSize=3")).status).toBe(400);
  expect((await call("/sandbox","rate-logs","GET",undefined,"")).status).toBe(401);
  expect((await call("/sandbox","rates","POST",{...shipment,carriers:["loomis"],comparisonId})).status).toBe(400);
  expect((await call("/sandbox","rates","POST",{...shipment,carriers:["loomis"],comparisonId,comparisonCarriers:["fedex"]})).status).toBe(400);
  const foreign=randomUUID(); await store.query("INSERT INTO company_groups VALUES (?,?,?)",[foreign,"Foreign company",new Date().toISOString()]);
  expect((await call("/sandbox",`rate-logs/${comparisonId}?groupId=${foreign}`)).status).toBe(404);
});

it("allows company users to delete a log and rejects foreign, expired or cross-origin requests",async()=>{
 const id=randomUUID();
 await store.query("INSERT INTO quote_logs VALUES (?,?,?,?,?,?,?)",[id,owner,owner,"sandbox","{}",JSON.stringify({carrierStatuses:[]}),new Date().toISOString()]);
 expect((await call("",`rate-logs/${id}`,"DELETE")).status).toBe(404);
 expect((await call("/sandbox",`rate-logs/${id}`,"DELETE",undefined,"")).status).toBe(401);
 const foreign=randomUUID();await store.query("INSERT INTO company_groups VALUES (?,?,?)",[foreign,"Foreign",new Date().toISOString()]);
 expect((await call("/sandbox",`rate-logs/${id}?groupId=${foreign}`,"DELETE")).status).toBe(404);
 const rejected=await DELETE(new Request(`${origin}/sandbox/api/v1/rate-logs/${id}`,{method:"DELETE",headers:{Origin:"https://foreign.test",Cookie:cookie}}),{params:Promise.resolve({path:["rate-logs",id]})});
 expect(rejected.status).toBe(403);
 await store.query("UPDATE users SET role='user' WHERE id=?",[owner]);
 expect((await call("/sandbox",`rate-logs/${id}?groupId=${foreign}`,"DELETE")).status).toBe(403);
 expect((await call("/sandbox",`rate-logs/${id}`,"DELETE")).status).toBe(204);
 expect((await call("/sandbox",`rate-logs/${id}`)).status).toBe(404);
});
