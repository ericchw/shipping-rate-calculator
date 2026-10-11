import { it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../src/lib/db";
import { Profiles } from "../src/lib/profiles";
const stores: Store[] = [];
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
});
export async function profileContract(store: Store) {
  await store.migrate();
  await store.migrate();
  const a = randomUUID(),
    b = randomUUID();
  for (const id of [a, b])
    await store.query(
      "INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)",
      [
        id,
        `${id}@example.com`,
        "not-a-login",
        "user",
        new Date().toISOString(),
      ],
    );
  const p = new Profiles(store);
  const input = {
    profile_name: "Vancouver Warehouse",
    address: {
      city: "Vancouver",
      region: "BC",
      postal_code: "V6B1A1",
      country_code: "CA",
    },
    is_default: true,
  };
  const first = await p.save(a, input);
  expect((await p.list(a))[0].is_default).toBe(true);
  expect(await p.list(b)).toEqual([]);
  await expect(p.get(b, first.id)).rejects.toMatchObject({ status: 404 });
  await expect(p.save(b, input, first.id)).rejects.toMatchObject({
    status: 404,
  });
  await expect(p.delete(b, first.id)).rejects.toMatchObject({ status: 404 });
  await expect(p.setDefault(b, first.id)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    p.save(a, { ...input, profile_name: "vancouver warehouse" }),
  ).rejects.toMatchObject({ status: 409 });
  await p.save(b, input);
  const second = await p.save(a, { ...input, profile_name: "Returns" });
  expect((await p.list(a)).filter((x) => x.is_default)).toHaveLength(1);
  await Promise.all([p.setDefault(a, first.id), p.setDefault(a, second.id)]);
  expect((await p.list(a)).filter((x) => x.is_default)).toHaveLength(1);
  await p.setDefault(a, first.id);
  await p.delete(a, first.id);
  expect((await p.list(a)).every((x) => !x.is_default)).toBe(true);
  await store.query("DELETE FROM users WHERE id=?", [a]);
  await store.query("DELETE FROM users WHERE id=?", [b]);
}
it("SQLite profile ownership, names, defaults, transactions, migration idempotency", async () => {
  const s = new Store("sqlite", "file::memory:");
  stores.push(s);
  await profileContract(s);
});
