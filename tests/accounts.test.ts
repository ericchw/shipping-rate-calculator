import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../src/lib/db";
import * as database from "../src/lib/db";
import { currentUser, login, passwordHash, type User } from "../src/lib/auth";
import { saveAccount, deleteAccount, listAccounts } from "../src/lib/accounts";
import { GET, POST, PATCH, DELETE } from "../src/app/api/v1/[...path]/route";

let store: Store, admin: User;
const origin = "http://localhost:3000";
const password = "account-test-password";
beforeEach(async () => {
  vi.stubEnv("APP_ORIGIN", origin);
  store = new Store("sqlite", "file::memory:"); await store.migrate(); await store.migrate();
  vi.spyOn(database, "db").mockReturnValue(store);
  admin = { id: randomUUID(), email: `${randomUUID()}@example.test`, role: "admin", webAccess: true, apiAccess: true, channel: "web" };
  await store.query("INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)", [admin.id, admin.email, await passwordHash(password), "admin", new Date().toISOString()]);
  await store.query("INSERT INTO company_groups(id,name,created_at) VALUES (?,?,?)", [admin.id, "Test company", new Date().toISOString()]);
  await store.query("INSERT INTO group_memberships(user_id,group_id) VALUES (?,?)", [admin.id, admin.id]);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await store.close(); });
const makeAccount = (webAccess = true, apiAccess = true) => saveAccount(admin, { email: `${randomUUID()}@example.test`, password, role: "user", webAccess, apiAccess, groupId: admin.id });
async function request(route: string, method: string, cookie = "", value?: unknown, requestOrigin = origin) {
  const handler = { GET, POST, PATCH, DELETE }[method as "GET"];
  return handler(new Request(`${origin}/api/v1/${route}`, { method, headers: { Cookie: cookie, Origin: requestOrigin, "Content-Type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value) }), { params: Promise.resolve({ path: route.split("/") }) });
}
const session = async (email: string, channel: "web" | "api" = "web") => `shipping_session=${(await login(email, password, channel)).token}`;
describe("admin accounts and access enforcement", () => {
  it("defaults new users to UAT and revokes sessions when environment access changes", async () => {
    const account = await makeAccount();
    expect(account).toMatchObject({ productionAccess: false, uatAccess: true });
    const cookie = await session(account.email);
    expect((await request("profiles", "GET", cookie)).status).toBe(403);
    await saveAccount(admin, { productionAccess: true, uatAccess: false }, account.id);
    expect(await currentUser(new Request(origin, { headers: { Cookie: cookie } }))).toBeNull();
    expect((await login(account.email, password, "api")).user).toMatchObject({ productionAccess: true, uatAccess: false });
    await saveAccount(admin, { productionAccess: false, uatAccess: false }, account.id);
    await expect(login(account.email, password, "web")).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(saveAccount(admin, { productionAccess: false, uatAccess: false }, admin.id)).rejects.toMatchObject({ code: "LAST_ADMIN" });
  });
  it("rejects a password reset that races with login verification", async () => {
    const transaction = store.transaction.bind(store);
    vi.spyOn(store, "transaction").mockImplementationOnce(async (fn) => {
      await store.query("UPDATE users SET password_hash=? WHERE id=?", [await passwordHash("replacement-password"), admin.id]);
      return transaction(fn);
    });
    await expect(login(admin.email, password, "web")).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    expect(await store.query("SELECT * FROM sessions")).toHaveLength(0);
  });
  it("creates, edits and deletes accounts without returning password hashes", async () => {
    const account = await makeAccount();
    expect(account).toMatchObject({ webAccess: true, apiAccess: true, role: "user" });
    expect(JSON.stringify(await listAccounts(admin))).not.toContain("password_hash");
    const cookie = await session(account.email);
    await saveAccount(admin, { email: "updated@example.test", password: "new-password", apiAccess: false }, account.id);
    expect(await currentUser(new Request(origin, { headers: { Cookie: cookie } }))).toBeNull();
    await expect(login("updated@example.test", password, "web")).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    expect((await login("updated@example.test", "new-password", "web")).user.apiAccess).toBe(false);
    await deleteAccount(admin, account.id);
    expect(await store.query("SELECT * FROM account_access WHERE user_id=?", [account.id])).toHaveLength(0);
    expect(await store.query("SELECT * FROM sessions WHERE user_id=?", [account.id])).toHaveLength(0);
  });
  it("enforces web/API access independently and reevaluates existing sessions", async () => {
    const webOnly = await makeAccount(true, false), apiOnly = await makeAccount(false, true), disabled = await makeAccount(false, false);
    expect((await login(webOnly.email, password, "web")).user.channel).toBe("web");
    await expect(login(webOnly.email, password, "api")).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect((await login(apiOnly.email, password, "api")).user.webAccess).toBe(false);
    await expect(login(apiOnly.email, password, "web")).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    for (const channel of ["web", "api"] as const) await expect(login(disabled.email, password, channel)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    const cookie = await session(webOnly.email);
    await store.query("UPDATE account_access SET web_access=0 WHERE user_id=?", [webOnly.id]);
    expect(await currentUser(new Request(origin, { headers: { Cookie: cookie } }))).toBeNull();
  });
  it("blocks nonadmins, API sessions, missing sessions and foreign Origin", async () => {
    const account = await makeAccount();
    expect((await request("admin/accounts", "GET")).status).toBe(401);
    expect((await request("admin/accounts", "GET", await session(account.email))).status).toBe(403);
    expect((await request("admin/accounts", "GET", await session(admin.email, "api"))).status).toBe(403);
    const cookie = await session(admin.email);
    expect((await request("admin/accounts", "GET", cookie)).status).toBe(200);
    expect((await request("admin/accounts", "POST", cookie, { email: "new@example.test", password, role: "user", webAccess: true, apiAccess: false }, "https://foreign.test")).status).toBe(403);
    expect((await request("admin/accounts", "POST", cookie, { email: "new@example.test", password: "123", role: "user", webAccess: true, apiAccess: false })).status).toBe(400);
  });
  it("protects the last web admin and rejects self deletion and duplicate email", async () => {
    await expect(saveAccount(admin, { role: "user" }, admin.id)).rejects.toMatchObject({ code: "LAST_ADMIN" });
    await expect(saveAccount(admin, { webAccess: false }, admin.id)).rejects.toMatchObject({ code: "LAST_ADMIN" });
    await expect(deleteAccount(admin, admin.id)).rejects.toMatchObject({ code: "SELF_DELETE" });
    await expect(saveAccount(admin, { email: admin.email.toUpperCase(), password, role: "user", webAccess: true, apiAccess: true })).rejects.toMatchObject({ code: "EMAIL_CONFLICT" });
    const other = await makeAccount();
    await saveAccount(admin, { role: "admin" }, other.id);
    await expect(saveAccount(admin, { role: "user" }, admin.id)).resolves.toMatchObject({ role: "user" });
    await expect(saveAccount(admin, { role: "admin" }, admin.id)).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  });
  it("supports management endpoints and preserves company credentials when deleting a user", async () => {
    const cookie = await session(admin.email);
    const created = await request("admin/accounts", "POST", cookie, { email: "api-created@example.test", password, role: "user", webAccess: false, apiAccess: true, groupId: admin.id });
    expect(created.status).toBe(201); const account = await created.json();
    expect((await request(`admin/accounts/${account.id}`, "PATCH", cookie, { webAccess: true })).status).toBe(200);
    await store.query("INSERT INTO group_carrier_settings (group_id,carrier,mode,enabled,encrypted_settings,updated_at) VALUES (?,?,?,?,?,?)", [admin.id, "fedex", "sandbox", 0, "ciphertext", new Date().toISOString()]);
    expect((await request(`admin/accounts/${account.id}`, "DELETE", cookie)).status).toBe(204);
    expect(await store.query("SELECT * FROM group_carrier_settings WHERE group_id=?", [admin.id])).toHaveLength(1);
  });
});
