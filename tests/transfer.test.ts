import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../src/lib/db";
import { Profiles } from "../src/lib/profiles";
import { transfer } from "../src/lib/transfer";
it("preserves users/profiles and refuses a populated target without copying sessions", async () => {
  const a = new Store("sqlite", "file::memory:");
  const b = new Store("sqlite", "file::memory:");
  try {
    await a.migrate();
    const id = randomUUID();
    await a.query(
      "INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)",
      [
        id,
        "transfer@example.invalid",
        "synthetic-hash",
        "user",
        new Date().toISOString(),
      ],
    );
    await a.query("INSERT INTO account_access VALUES (?,?,?)", [id, 0, 0]);
    const p = await new Profiles(a).save(id, {
      profile_name: "Warehouse",
      address: {
        city: "Vancouver",
        region: "BC",
        postal_code: "V6B1A1",
        country_code: "CA",
      },
      is_default: true,
    });
    await a.query("INSERT INTO sessions VALUES (?,?,?)", [
      "synthetic-session",
      id,
      "2099-01-01T00:00:00Z",
    ]);
    expect(await transfer(a, b)).toEqual({ users: 1, profiles: 1 });
    expect(await new Profiles(b).get(id, p.id)).toEqual(p);
    expect(await b.query("SELECT * FROM account_access")).toEqual([{ user_id: id, web_access: 0, api_access: 0 }]);
    expect(await b.query("SELECT * FROM sessions")).toEqual([]);
    await expect(transfer(a, b)).rejects.toThrow("empty");
    expect(await new Profiles(a).list(id)).toHaveLength(1);
  } finally {
    await a.close();
    await b.close();
  }
});
