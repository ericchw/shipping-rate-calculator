import { expect, it } from "vitest";
import { Store } from "../src/lib/db";
import { Labels } from "../src/lib/labels";
import { shipmentSchema } from "../src/lib/schemas";
it("persists labels with shipment details and isolates owner and environment", async () => {
  const store = new Store("sqlite", "file::memory:");
  try {
    await store.migrate(); await store.migrate();
    for (const owner of ["owner-a", "owner-b"]) await store.query("INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)", [owner, `${owner}@example.com`, "unused", "user", new Date().toISOString()]);
    for (const id of ["owner-a", "owner-b"]) {
      await store.query("INSERT INTO company_groups(id,name,created_at) VALUES (?,?,?)", [id, id, new Date().toISOString()]);
      await store.query("INSERT INTO group_memberships(user_id,group_id) VALUES (?,?)", [id, id]);
    }
    const repository = new Labels(store);
    const shipment = shipmentSchema.parse({ ship_from: { city: "Vancouver", region: "BC", postal_code: "V6B1A1" }, ship_to: { city: "Toronto", region: "ON", postal_code: "M5V2T6" }, shipDate: "2026-10-14", packages: [{ length: 12, width: 8, height: 6, dimensionUnit: "in", weight: 5, weightUnit: "lb" }] });
    const saved = await repository.save("owner-a", { mode: "sandbox", service_code: "DD", label_id: "1234", shipment_number: "TEST1234", shipment, labels: ["original-png"] });
    expect((await repository.list("owner-a", "sandbox")).labels[0]).toMatchObject({ id: saved.id, shipment_number: "TEST1234" });
    const summary = (await repository.list("owner-a", "sandbox")).labels[0];
    expect(summary).not.toHaveProperty("labels");
    expect(summary.ship_from).toMatchObject({ city: "Vancouver", region: "BC" });
    expect(summary.ship_to).toMatchObject({ city: "Toronto", region: "ON" });
    expect(summary).not.toHaveProperty("shipment_json");
    expect(await new Labels(store).get("owner-a", "sandbox", saved.id)).toEqual(saved);
    expect((await repository.list("owner-b", "sandbox")).labels).toEqual([]);
    expect((await repository.list("owner-a", "production")).labels).toEqual([]);
    await expect(repository.get("owner-b", "sandbox", saved.id)).rejects.toMatchObject({ status: 404 });
    await expect(repository.get("owner-a", "production", saved.id)).rejects.toMatchObject({ status: 404 });
    for (let index = 0; index < 24; index++) await repository.save("owner-a", { mode: "sandbox", service_code: "DD", label_id: String(index), shipment_number: String(index), shipment, labels: ["png"] });
    const firstPage = await repository.list("owner-a", "sandbox", 1, 10);
    const secondPage = await repository.list("owner-a", "sandbox", 2, 10);
    const lastPage = await repository.list("owner-a", "sandbox", 99, 10);
    expect(firstPage).toMatchObject({ total: 25, page: 1, pageSize: 10, totalPages: 3 });
    expect(firstPage.labels).toHaveLength(10);
    expect(secondPage.labels).toHaveLength(10);
    expect(secondPage.labels.some((row) => firstPage.labels.some((first) => first.id === row.id))).toBe(false);
    expect(lastPage).toMatchObject({ page: 3, totalPages: 3 });
    expect(lastPage.labels).toHaveLength(5);
    expect((await repository.list("owner-a", "sandbox", 1, 50)).labels).toHaveLength(25);
    expect(await repository.list("owner-b", "sandbox", 99, 10)).toMatchObject({ labels: [], total: 0, page: 1, totalPages: 1 });
  } finally { await store.close(); }
});
