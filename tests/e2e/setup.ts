import type { FullConfig } from "@playwright/test";
import { randomUUID, scryptSync, randomBytes } from "node:crypto";
import { defaultCarrierUrl } from "../../src/lib/carrier-settings-schema";
import { Store } from "../../src/lib/db";
export default async function setup(config: FullConfig) {
  const store = new Store("sqlite", "file:./data/e2e.db");
  await store.migrate();
  const salt = randomBytes(16).toString("hex");
  const password = `${salt}:${scryptSync("fixture-password-only", salt, 64).toString("hex")}`;
  await store.query("DELETE FROM users WHERE email=?", ["e2e@example.invalid"]);
  const owner = randomUUID();
  await store.query(
    "INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)",
    [
      owner,
      "e2e@example.invalid",
      password,
      "admin",
      new Date().toISOString(),
    ],
  );
  let groupId: string = randomUUID(), otherGroupId: string = randomUUID();
  for (const [id, name] of [[groupId, "Fixture company"], [otherGroupId, "Other fixture company"]]) await store.query("INSERT INTO company_groups(id,name,created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING", [id, name, new Date().toISOString()]);
  groupId = (await store.query<{ id: string }>("SELECT id FROM company_groups WHERE name=?", ["Fixture company"]))[0].id;
  otherGroupId = (await store.query<{ id: string }>("SELECT id FROM company_groups WHERE name=?", ["Other fixture company"]))[0].id;
  for (const id of [groupId, otherGroupId]) {
    await store.query("DELETE FROM quote_logs WHERE group_id=?", [id]);
    await store.query("DELETE FROM company_labels WHERE group_id=?", [id]);
    await store.query("DELETE FROM group_carrier_settings WHERE group_id=?", [id]);
    await store.query("DELETE FROM group_generation_settings WHERE group_id=?", [id]);
  }
  await store.query("INSERT INTO group_memberships(user_id,group_id) VALUES (?,?)", [owner, groupId]);
  for (const [email, company] of [["group-admin@example.invalid", groupId], ["group-user@example.invalid", groupId], ["group-colleague@example.invalid", groupId], ["other-user@example.invalid", otherGroupId]]) {
    await store.query("DELETE FROM users WHERE email=?", [email]);
    const id = randomUUID();
    await store.query("INSERT INTO users(id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)", [id, email, password, email === "group-admin@example.invalid" ? "admin" : "user", new Date().toISOString()]);
    await store.query("INSERT INTO group_memberships(user_id,group_id) VALUES (?,?)", [id, company]);
  }
  const labelOwner = (await store.query<{ id: string }>("SELECT id FROM users WHERE email=?", ["group-user@example.invalid"]))[0].id;
  const address = { city: "Vancouver", region: "BC", postal_code: "V6B1A1", country_code: "CA", contact_name: "Company Sender", company: "Fixture company", address_line1: "1 Test Street", address_line2: "", phone: "6045550100", email: "" };
  const shipment = { ship_from: address, ship_to: { ...address, city: "Toronto", region: "ON", postal_code: "M5V2T6", contact_name: "Company Recipient" }, shipDate: "2026-10-14", packages: [{ weight: 1, weightUnit: "lb", length: 0, width: 0, height: 0, dimensionUnit: "in" }], signatureRequired: false, coverageAmount: 0, coverageCurrency: "CAD", carrierMode: "sandbox", carriers: ["loomis"] };
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
  await store.query("INSERT INTO company_labels(id,group_id,user_id,mode,service_code,label_id,shipment_number,shipment_json,labels_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", [randomUUID(), groupId, labelOwner, "sandbox", "DD", "GROUP1", "GROUP123", JSON.stringify(shipment), JSON.stringify([png]), new Date().toISOString()]);
  await store.close();
  const origin = config.projects[0].use.baseURL!;
  const login = await fetch(`${origin}/sandbox/api/v1/auth/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email: "e2e@example.invalid", password: "fixture-password-only", channel: "web" }) });
  if (!login.ok) throw new Error("Could not sign in to seed enabled test carriers");
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  for (const carrier of ["canada_post", "loomis", "fedex"] as const) {
    const fields = carrier === "canada_post" ? { API_KEY: "fixture-key", API_SECRET: "fixture-secret" } : carrier === "loomis" ? { USERNAME: "fixture-user", PASSWORD: "fixture-secret", ACCOUNT_NUMBER: "fixture-account" } : { CLIENT_ID: "fixture-client", CLIENT_SECRET: "fixture-secret", ACCOUNT_NUMBER: "fixture-account" };
    const saved = await fetch(`${origin}/sandbox/api/v1/carrier-settings/sandbox/${carrier}`, { method: "PUT", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true, baseUrl: defaultCarrierUrl(carrier, "sandbox"), fields }) });
    if (!saved.ok) throw new Error(`Could not enable test carrier ${carrier}`);
  }
  await fetch(`${origin}/sandbox/api/v1/auth/logout`, { method: "POST", headers: { Origin: origin, Cookie: cookie } });
}
