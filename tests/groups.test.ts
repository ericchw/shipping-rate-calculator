import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID, createCipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/lib/db";
import * as database from "../src/lib/db";
import { currentUser, login, passwordHash, type User } from "../src/lib/auth";
import { saveAccount, deleteAccount } from "../src/lib/accounts";
import { listGroups, saveGroup, deleteGroup, userGroup } from "../src/lib/groups";
import * as settingsModule from "../src/lib/carrier-settings";
import { CarrierSettings } from "../src/lib/carrier-settings";
import { generationEnabled, saveGenerationSetting } from "../src/lib/generation-settings";
import { Labels } from "../src/lib/labels";
import { shipmentSchema } from "../src/lib/schemas";
import { defaultCarrierUrl } from "../src/lib/carrier-settings-schema";
import { GET, POST, PUT, DELETE, PATCH } from "../src/app/api/v1/[...path]/route";

let store: Store, admin: User, directory: string, settings: CarrierSettings;
const origin = "http://localhost:3000";
const password = "group-test-password";
const shipment = shipmentSchema.parse({ ship_from: { city: "Vancouver", region: "BC", postal_code: "V6B1A1" }, ship_to: { city: "Toronto", region: "ON", postal_code: "M5V2T6" }, shipDate: "2026-10-14", packages: [{ length: 0, width: 0, height: 0, dimensionUnit: "in", weight: 1, weightUnit: "lb" }], carrierMode: "sandbox", carriers: ["loomis"] });
const credentials = { enabled: true, baseUrl: defaultCarrierUrl("loomis", "sandbox"), fields: { USERNAME: "company-a", PASSWORD: "company-secret", ACCOUNT_NUMBER: "company-account" } };
beforeEach(async () => {
  vi.stubEnv("APP_ORIGIN", origin); vi.stubEnv("APP_ENV", "development"); vi.stubEnv("MOCK_CARRIERS", "true");
  store = new Store("sqlite", "file::memory:"); await store.migrate();
  vi.spyOn(database, "db").mockReturnValue(store);
  admin = { id: randomUUID(), email: `${randomUUID()}@example.test`, role: "admin", webAccess: true, channel: "web" };
  await store.query("INSERT INTO users(id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)", [admin.id, admin.email, await passwordHash(password), "admin", new Date().toISOString()]);
  directory = mkdtempSync(path.join(tmpdir(), "group-settings-"));
  const Repository = CarrierSettings;
  settings = new Repository(store, path.join(directory, "key"));
  vi.spyOn(settingsModule, "CarrierSettings").mockImplementation((_store, _key, groupId) => new Repository(store, path.join(directory, "key"), groupId));

});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); await store.close(); rmSync(directory, { recursive: true, force: true }); });
async function account(groupId: string) {
  return saveAccount(admin, { email: `${randomUUID()}@example.test`, password, role: "user", webAccess: true, apiAccess: true, groupId });
}
async function cookie(email: string, channel: "web" | "api" = "web") { return `shipping_session=${(await login(email, password, channel)).token}`; }
async function request(session: string, route: string, method = "GET", value?: unknown) {
  const handler = { GET, POST, PUT, DELETE, PATCH }[method as "GET"];
  const response = await handler(new Request(`${origin}/sandbox/api/v1/${route}`, { method, headers: { Origin: origin, Cookie: session, "Content-Type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value) }), { params: Promise.resolve({ path: route.split("?")[0].split("/") }) });
  return { status: response.status, data: response.status === 204 ? null : await response.json() };
}
it("shares group credentials and labels, isolates companies, and preserves data after creator deletion", async () => {
  const a = await saveGroup(admin, { name: "Company A" }), b = await saveGroup(admin, { name: "Company B" });
  const author = await account(a.id), colleague = await account(a.id), outsider = await account(b.id);
  await settings.save(author.id, "loomis", "sandbox", credentials, admin);
  expect((await settings.config(colleague.id, "loomis", "sandbox")).get("PASSWORD")).toBe("company-secret");
  expect((await settings.config(outsider.id, "loomis", "sandbox")).enabled).toBe(false);
  expect((await settings.config(colleague.id, "loomis", "production")).enabled).toBe(false);
  expect(await generationEnabled("sandbox", a.id)).toBe(false);
  await saveGenerationSetting(admin, "sandbox", true, a.id);
  expect(await generationEnabled("sandbox", a.id)).toBe(true);
  expect(await generationEnabled("production", a.id)).toBe(false);
  expect(await generationEnabled("sandbox", b.id)).toBe(false);
  const repository = new Labels(store);
  const saved = await repository.save(author.id, { mode: "sandbox", service_code: "DD", label_id: "A1", shipment_number: "A123", shipment, labels: ["png"] });
  expect((await repository.list(colleague.id, "sandbox")).total).toBe(1);
  expect((await repository.get(colleague.id, "sandbox", saved.id)).labels).toEqual(["png"]);
  await expect(repository.get(outsider.id, "sandbox", saved.id)).rejects.toMatchObject({ status: 404 });
  await deleteAccount(admin, author.id);
  expect((await repository.get(colleague.id, "sandbox", saved.id)).shipment_number).toBe("A123");
  expect((await settings.config(colleague.id, "loomis", "sandbox")).enabled).toBe(true);
  expect((await store.query<{ user_id: string | null }>("SELECT user_id FROM company_labels WHERE id=?", [saved.id]))[0].user_id).toBeNull();
  await store.migrate();
  expect(await listGroups(admin)).toHaveLength(2);
});
it("requires an admin web session for company management and protects users from group override and credentials exposure", async () => {
  const a = await saveGroup(admin, { name: "Company A" }), b = await saveGroup(admin, { name: "Company B" });
  const user = await account(a.id);
  const session = await cookie(user.email);
  expect((await request(session, "auth/session")).data.group).toEqual({ id: a.id, name: a.name });
  for (const [route, method, value] of [
    ["admin/groups", "POST", { name: "Injected" }],
    [`admin/groups/${a.id}`, "PATCH", { name: "Renamed" }],
    ["admin/accounts", "POST", { email: "injected@example.test", password, role: "admin", webAccess: true, apiAccess: true, groupId: a.id }],
    ["carrier-settings/sandbox/loomis", "PUT", credentials],
    ["carrier-settings/sandbox/loomis", "DELETE", undefined],
    ["carrier-settings/sandbox/loomis/test", "POST", undefined],
    [`carrier-settings?groupId=${b.id}`, "GET", undefined],
    [`labels?groupId=${b.id}`, "GET", undefined],
    [`admin/generation-settings?groupId=${a.id}`, "PUT", { enabled: true }],
  ] as const) expect((await request(session, route, method, value)).status).toBe(403);
  const publicSettings = await request(session, "carrier-settings");
  expect(publicSettings.status).toBe(200);
  expect(publicSettings.data.settings[0]).toEqual({ carrier: "canada_post", mode: "sandbox", enabled: false, configured: false });
  expect((await request("", "auth/register", "POST", { email: "self@example.test", password })).status).not.toBe(201);
  const apiAdmin = await cookie(admin.email, "api");
  expect((await request(apiAdmin, "admin/groups")).status).toBe(403);
  expect((await request(apiAdmin, `carrier-settings?groupId=${a.id}`)).status).toBe(403);
  const webAdmin = await cookie(admin.email);
  expect((await request(webAdmin, "admin/groups")).data.groups).toHaveLength(2);
  expect((await request(webAdmin, `carrier-settings/sandbox/loomis?groupId=${a.id}`, "PUT", credentials)).status).toBe(200);
  const configured = await request(session, "carrier-settings");
  expect(configured.data.settings.find((setting: { carrier: string }) => setting.carrier === "loomis")).toEqual({ carrier: "loomis", mode: "sandbox", enabled: true, configured: true });
  expect(JSON.stringify(configured.data)).not.toContain("company-account");
  expect(JSON.stringify(configured.data)).not.toContain("company-secret");
  expect((await request(webAdmin, `carrier-settings?groupId=${b.id}`)).data.settings.every((setting: { enabled: boolean }) => !setting.enabled)).toBe(true);
  const quote = await request(session, "rates", "POST", shipment);
  expect(quote.status).toBe(200);
  expect(quote.data.results.length).toBeGreaterThan(0);
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  const blocked = await request(session, "loomis/labels", "POST", { shipment, serviceCode: "DD" });
  expect(blocked.data.error.code).toBe("GENERATION_DISABLED");
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await request(webAdmin, `admin/groups/${a.id}`, "PATCH", { name: "Renamed A" })).status).toBe(200);
  expect((await request(webAdmin, `admin/generation-settings?groupId=${b.id}`, "PUT", { enabled: true })).status).toBe(200);
  expect((await request(session, "auth/session")).data.generationEnabled).toBe(false);
});
it("requires group assignment, revokes sessions on reassignment and leaves labels with the original company", async () => {
  await expect(saveAccount(admin, { email: "nogroup@example.test", password, role: "user", webAccess: true, apiAccess: true })).rejects.toMatchObject({ code: "GROUP_REQUIRED" });
  await expect(saveAccount(admin, { email: "missing@example.test", password, role: "user", webAccess: true, apiAccess: true, groupId: randomUUID() })).rejects.toMatchObject({ code: "INVALID_GROUP" });
  const a = await saveGroup(admin, { name: "Company A" }), b = await saveGroup(admin, { name: "Company B" });
  const user = await account(a.id);
  const session = await cookie(user.email);
  const saved = await new Labels(store).save(user.id, { mode: "sandbox", service_code: "DD", label_id: "1", shipment_number: "A1", shipment, labels: ["png"] });
  await saveAccount(admin, { groupId: b.id }, user.id);
  expect(await currentUser(new Request(origin, { headers: { Cookie: session } }))).toBeNull();
  expect(await userGroup(user.id)).toEqual({ id: b.id, name: b.name });
  await expect(new Labels(store).get(user.id, "sandbox", saved.id)).rejects.toMatchObject({ status: 404 });
  expect((await new Labels(store, a.id).get(admin.id, "sandbox", saved.id)).id).toBe(saved.id);
  await expect(saveGroup(admin, { name: "company a" })).rejects.toMatchObject({ code: "GROUP_NAME_CONFLICT" });
});
it("migrates existing credentials and labels once without changing encryption or company membership", async () => {
  vi.restoreAllMocks();
  vi.spyOn(database, "db").mockReturnValue(store);
  // Create a legacy database containing only migrations 1–5.
  const legacy = new Store("sqlite", "file::memory:");
  try {
    for (const file of readdirSync("migrations/sqlite").filter(file => /^00[1-5]_/.test(file)).sort()) {
      // Store.query executes one statement; use its SQLite connection only for the legacy fixture.
      const sqlite = (legacy as unknown as { sqlite: { exec(sql: string): void } }).sqlite;
      sqlite.exec(readFileSync(path.join("migrations/sqlite", file), "utf8"));
    }
    const owner = randomUUID(), groupId = randomUUID();
    await legacy.query("INSERT INTO users(id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)", [owner, "legacy@example.test", "hash", "user", new Date().toISOString()]);
    const key = randomBytes(32), iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(`${owner}:loomis:sandbox`));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ baseUrl: credentials.baseUrl, fields: credentials.fields, quoteType: "counter" })), cipher.final()]);
    const ciphertext = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
    const keyFile = path.join(directory, "legacy-key"); writeFileSync(keyFile, key);
    await legacy.query("INSERT INTO carrier_settings VALUES (?,?,?,?,?,?)", [owner, "loomis", "sandbox", 1, ciphertext, new Date().toISOString()]);
    const labelId = randomUUID();
    await legacy.query("INSERT INTO generated_labels VALUES (?,?,?,?,?,?,?,?,?)", [labelId, owner, "sandbox", "DD", "1", "LEGACY", JSON.stringify(shipment), JSON.stringify(["original"]), new Date().toISOString()]);
    await legacy.query("INSERT INTO generation_settings VALUES (?,?)", ["sandbox", 1]);
    await legacy.migrate(); await legacy.migrate();
    expect((await new CarrierSettings(legacy, keyFile).config(owner, "loomis", "sandbox")).get("PASSWORD")).toBe("company-secret");
    expect((await new Labels(legacy).get(owner, "sandbox", labelId)).labels).toEqual(["original"]);
    expect((await legacy.query<{ enabled: number }>("SELECT enabled FROM group_generation_settings WHERE group_id=?", [owner]))[0].enabled).toBe(1);
    await legacy.query("INSERT INTO company_groups VALUES (?,?,?)", [groupId, "New company", new Date().toISOString()]);
    await legacy.query("UPDATE group_memberships SET group_id=? WHERE user_id=?", [groupId, owner]);
    await legacy.migrate();
    expect((await userGroup(owner, legacy))?.id).toBe(groupId);
    expect((await new CarrierSettings(legacy, keyFile).config(owner, "loomis", "sandbox")).enabled).toBe(false);
    expect((await new Labels(legacy, owner).get(owner, "sandbox", labelId)).shipment_number).toBe("LEGACY");
  } finally { await legacy.close(); }
});

it("rechecks administrator permissions inside settings writes", async () => {
  const group = await saveGroup(admin, { name: "Company A" });
  await store.query("UPDATE users SET role='user' WHERE id=?", [admin.id]);
  await expect(new CarrierSettings(store, path.join(directory, "key"), group.id).save(admin.id, "loomis", "sandbox", credentials, admin)).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  await expect(saveGenerationSetting(admin, "sandbox", true, group.id)).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  await expect(saveGroup(admin, { name: "Unauthorized" })).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  expect(await store.query("SELECT * FROM group_carrier_settings")).toHaveLength(0);
});

it("deletes only empty companies and removes their connection permissions", async () => {
  const empty = await saveGroup(admin, { name: "Empty company" });
  await store.query("INSERT INTO group_generation_settings VALUES (?,?,?)", [empty.id,"sandbox",1]);
  await store.query("INSERT INTO group_carrier_settings VALUES (?,?,?,?,?,?)", [empty.id,"loomis","sandbox",0,"unused-ciphertext",new Date().toISOString()]);
  const user = await account(empty.id);
  await expect(deleteGroup(admin, empty.id)).rejects.toMatchObject({ code: "GROUP_HAS_MEMBERS" });
  await deleteAccount(admin,user.id);
  const apiAdmin = await cookie(admin.email,"api");
  expect((await request(apiAdmin,`admin/groups/${empty.id}`,"DELETE")).status).toBe(403);
  const webAdmin = await cookie(admin.email);
  expect((await request(webAdmin,`admin/groups/${empty.id}`,"DELETE")).status).toBe(204);
  expect(await store.query("SELECT * FROM company_groups WHERE id=?",[empty.id])).toHaveLength(0);
  expect(await store.query("SELECT * FROM group_carrier_settings WHERE group_id=?",[empty.id])).toHaveLength(0);
  expect(await store.query("SELECT * FROM group_generation_settings WHERE group_id=?",[empty.id])).toHaveLength(0);
});
it("preserves company history when someone attempts to delete a group", async () => {
  const group = await saveGroup(admin,{name:"Company history"});
  const user = await account(group.id);
  const label = await new Labels(store).save(user.id,{mode:"sandbox",service_code:"DD",label_id:"1",shipment_number:"HISTORY",shipment,labels:["png"]});
  await deleteAccount(admin,user.id);
  await expect(deleteGroup(admin,group.id)).rejects.toMatchObject({code:"GROUP_HAS_HISTORY"});
  expect((await new Labels(store,group.id).get(admin.id,"sandbox",label.id)).shipment_number).toBe("HISTORY");
  const logged = await saveGroup(admin,{name:"Rate history"});
  await store.query("INSERT INTO quote_logs VALUES (?,?,?,?,?,?,?)",[randomUUID(),logged.id,null,"sandbox","{}","{}",new Date().toISOString()]);
  await expect(deleteGroup(admin,logged.id)).rejects.toMatchObject({code:"GROUP_HAS_HISTORY"});
  expect(await store.query("SELECT id FROM quote_logs WHERE group_id=?",[logged.id])).toHaveLength(1);
  await expect(deleteGroup({...admin,role:"user"},group.id)).rejects.toMatchObject({code:"ADMIN_REQUIRED"});
});
