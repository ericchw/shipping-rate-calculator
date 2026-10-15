import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, type Connection } from "./db";
import { assertAdmin, type User } from "./auth";
import { AppError } from "./errors";

export type CompanyGroup = { id: string; name: string; created_at: string; memberCount: number };
export async function userGroup(userId: string, connection: Connection = db()) {
  const [row] = await connection.query<{ id: string; name: string }>("SELECT g.id,g.name FROM company_groups g JOIN group_memberships m ON m.group_id=g.id WHERE m.user_id=?", [userId]);
  return row ?? null;
}
export async function requireGroup(userId: string, connection: Connection = db()) {
  const group = await userGroup(userId, connection);
  if (!group) throw new AppError(403, "GROUP_REQUIRED", "Ask an administrator to assign your account to a company group.");
  return group.id;
}
export async function authorizeAdmin(tx: Connection, actor: User) {
  assertAdmin(actor);
  // Serialize with account changes, including role and web-access revocation.
  if (db().provider === "postgresql") await tx.query("SELECT pg_advisory_xact_lock(83192648)");
  const [row] = await tx.query<{ role: User["role"]; web_access: number }>("SELECT u.role,COALESCE(a.web_access,1) AS web_access FROM users u LEFT JOIN account_access a ON a.user_id=u.id WHERE u.id=?", [actor.id]);
  if (!row) throw new AppError(401, "UNAUTHORIZED", "Sign in to continue");
  assertAdmin({ ...actor, role: row.role, webAccess: !!row.web_access });
}
export async function managedGroup(actor: User, requested: string | null) {
  if (!requested) return requireGroup(actor.id);
  assertAdmin(actor);
  const id = z.string().uuid().parse(requested);
  if (!(await db().query("SELECT id FROM company_groups WHERE id=?", [id])).length) throw new AppError(404, "NOT_FOUND", "Company group not found");
  return id;
}
export async function listGroups(actor: User): Promise<CompanyGroup[]> {
  assertAdmin(actor);
  const rows = await db().query<Omit<CompanyGroup, "memberCount"> & { member_count: string | number }>("SELECT g.id,g.name,g.created_at,(SELECT COUNT(*) FROM group_memberships m WHERE m.group_id=g.id) AS member_count FROM company_groups g ORDER BY lower(g.name),g.id");
  return rows.map(({ member_count, ...group }) => ({ ...group, memberCount: Number(member_count) }));
}
export async function saveGroup(actor: User, value: unknown, id?: string) {
  assertAdmin(actor);
  const { name } = z.object({ name: z.string().trim().min(1).max(200) }).strict().parse(value);
  return db().transaction(async (tx) => {
    await authorizeAdmin(tx, actor);
    if (id && !(await tx.query("SELECT id FROM company_groups WHERE id=?", [id])).length) throw new AppError(404, "NOT_FOUND", "Company group not found");
    const duplicates = await tx.query<{ id: string }>("SELECT id FROM company_groups WHERE lower(name)=lower(?)", [name]);
    if (duplicates.some((group) => group.id !== id)) throw new AppError(409, "GROUP_NAME_CONFLICT", "A company group with that name already exists.");
    const groupId = id ?? randomUUID();
    if (id) await tx.query("UPDATE company_groups SET name=? WHERE id=?", [name, id]);
    else await tx.query("INSERT INTO company_groups(id,name,created_at) VALUES (?,?,?)", [groupId, name, new Date().toISOString()]);
    return { id: groupId, name };
  });
}

export async function deleteGroup(actor: User, id: string) {
  assertAdmin(actor);
  await db().transaction(async tx => {
    await authorizeAdmin(tx, actor);
    const [group] = await tx.query<{ id: string }>(`SELECT id FROM company_groups WHERE id=?${db().provider === "postgresql" ? " FOR UPDATE" : ""}`, [id]);
    if (!group) throw new AppError(404, "NOT_FOUND", "Company group not found");
    if ((await tx.query("SELECT user_id FROM group_memberships WHERE group_id=? LIMIT 1", [id])).length)
      throw new AppError(409, "GROUP_HAS_MEMBERS", "Move this company's members to another group before deleting it.");
    if ((await tx.query("SELECT id FROM company_labels WHERE group_id=? LIMIT 1", [id])).length || (await tx.query("SELECT id FROM quote_logs WHERE group_id=? LIMIT 1", [id])).length)
      throw new AppError(409, "GROUP_HAS_HISTORY", "This company has saved labels or rate logs. Keep the group to preserve its shipment history.");
    await tx.query("DELETE FROM group_carrier_settings WHERE group_id=?", [id]);
    await tx.query("DELETE FROM group_generation_settings WHERE group_id=?", [id]);
    await tx.query("DELETE FROM company_groups WHERE id=?", [id]);
  });
}
