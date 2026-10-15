import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, type Connection } from "./db";
import { assertAdmin, passwordHash, type User } from "./auth";
import { AppError } from "./errors";

const fields = {
  email: z.string().trim().email().max(200).transform(value => value.toLowerCase()),
  password: z.string().min(6).max(256),
  role: z.enum(["user", "operator", "admin"]),
  webAccess: z.boolean(), apiAccess: z.boolean(),
  productionAccess: z.boolean().optional(), uatAccess: z.boolean().optional(),
  groupId: z.string().uuid().nullable().optional(),
};
const createSchema = z.object(fields).strict();
const editSchema = z.object(fields).partial().strict().refine(value => Object.keys(value).length > 0, "No changes provided");
export type Account = { id: string; email: string; role: User["role"]; webAccess: boolean; apiAccess: boolean; productionAccess: boolean; uatAccess: boolean; created_at: string; groupId: string | null; groupName: string | null };
type AccountRow = Omit<Account, "webAccess" | "apiAccess" | "productionAccess" | "uatAccess" | "groupId" | "groupName"> & { web_access: number; api_access: number; production_access: number; uat_access: number; group_id: string | null; group_name: string | null };
const select = "SELECT u.id,u.email,u.role,u.created_at,m.group_id,g.name AS group_name,COALESCE(a.web_access,1) AS web_access,COALESCE(a.api_access,1) AS api_access,COALESCE(e.production_access,1) AS production_access,COALESCE(e.uat_access,1) AS uat_access FROM users u LEFT JOIN account_access a ON a.user_id=u.id LEFT JOIN account_environment_access e ON e.user_id=u.id LEFT JOIN group_memberships m ON m.user_id=u.id LEFT JOIN company_groups g ON g.id=m.group_id";
const publicAccount = (row: AccountRow): Account => ({ id: row.id, email: row.email, role: row.role, created_at: row.created_at, webAccess: !!row.web_access, apiAccess: !!row.api_access, productionAccess: !!row.production_access, uatAccess: !!row.uat_access, groupId: row.group_id, groupName: row.group_name });
async function lock(tx: Connection) {
  // Serialize role changes so concurrent edits cannot remove every administrator.
  if (db().provider === "postgresql") await tx.query("SELECT pg_advisory_xact_lock(83192648)");
}
async function authorize(tx: Connection, actor: User) {
  const row = (await tx.query<AccountRow>(`${select} WHERE u.id=?`, [actor.id]))[0];
  if (!row) throw new AppError(401, "UNAUTHORIZED", "Sign in to continue");
  assertAdmin({ ...publicAccount(row), channel: actor.channel });
}
export async function listAccounts(actor: User) {
  assertAdmin(actor);
  return (await db().query<AccountRow>(`${select} ORDER BY lower(u.email)`)).map(publicAccount);
}
export async function saveAccount(actor: User, value: unknown, id?: string) {
  assertAdmin(actor);
  const input = id ? editSchema.parse(value) : createSchema.parse(value);
  const hash = input.password ? await passwordHash(input.password) : undefined;
  return db().transaction(async tx => {
    await lock(tx); await authorize(tx, actor);
    const old = id ? (await tx.query<AccountRow>(`${select} WHERE u.id=?`, [id]))[0] : undefined;
    if (id && !old) throw new AppError(404, "NOT_FOUND", "Account not found");
    const email = input.email ?? old!.email;
    const role = input.role ?? old!.role;
    const web = input.webAccess ?? !!old!.web_access;
    const api = input.apiAccess ?? !!old!.api_access;
    const production = input.productionAccess ?? (old ? !!old.production_access : false);
    const uat = input.uatAccess ?? (old ? !!old.uat_access : true);
    if ((await tx.query<{ id: string }>("SELECT id FROM users WHERE lower(email)=lower(?)", [email])).some(row => row.id !== id))
      throw new AppError(409, "EMAIL_CONFLICT", "An account with this email already exists");
    if (old?.role === "admin" && old.web_access && (role !== "admin" || !web || (!production && !uat))) await preserveAdmin(tx, id!);
    const groupId = input.groupId === undefined ? old?.group_id ?? null : input.groupId;
    if (!groupId && role !== "admin") throw new AppError(400, "GROUP_REQUIRED", "Choose a company group for this account.");
    if (groupId && !(await tx.query("SELECT id FROM company_groups WHERE id=?", [groupId])).length) throw new AppError(400, "INVALID_GROUP", "Choose an existing company group.");
    const accountId = id ?? randomUUID();
    if (id) {
      await tx.query("UPDATE users SET email=?,role=? WHERE id=?", [email, role, id]);
      if (hash) await tx.query("UPDATE users SET password_hash=? WHERE id=?", [hash, id]);
      await tx.query("DELETE FROM sessions WHERE user_id=?", [id]);
    } else await tx.query("INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)", [accountId, email, hash!, role, new Date().toISOString()]);
    await tx.query("INSERT INTO account_access (user_id,web_access,api_access) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET web_access=excluded.web_access,api_access=excluded.api_access", [accountId, Number(web), Number(api)]);
    await tx.query("INSERT INTO account_environment_access(user_id,production_access,uat_access) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET production_access=excluded.production_access,uat_access=excluded.uat_access", [accountId, Number(production), Number(uat)]);
    if (groupId) await tx.query("INSERT INTO group_memberships(user_id,group_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET group_id=excluded.group_id", [accountId, groupId]);
    else await tx.query("DELETE FROM group_memberships WHERE user_id=?", [accountId]);
    return publicAccount((await tx.query<AccountRow>(`${select} WHERE u.id=?`, [accountId]))[0]);
  });
}
async function preserveAdmin(tx: Connection, id: string) {
  const others = await tx.query<{ id: string }>("SELECT u.id FROM users u LEFT JOIN account_access a ON a.user_id=u.id LEFT JOIN account_environment_access e ON e.user_id=u.id WHERE u.role='admin' AND COALESCE(a.web_access,1)=1 AND (COALESCE(e.production_access,1)=1 OR COALESCE(e.uat_access,1)=1) AND u.id<>?", [id]);
  if (!others.length) throw new AppError(409, "LAST_ADMIN", "Keep at least one administrator with web access");
}
export async function deleteAccount(actor: User, id: string) {
  assertAdmin(actor);
  if (id === actor.id) throw new AppError(409, "SELF_DELETE", "You cannot delete your own account");
  await db().transaction(async tx => {
    await lock(tx); await authorize(tx, actor);
    const old = (await tx.query<AccountRow>(`${select} WHERE u.id=?`, [id]))[0];
    if (!old) throw new AppError(404, "NOT_FOUND", "Account not found");
    if (old.role === "admin" && old.web_access) await preserveAdmin(tx, id);
    await tx.query("DELETE FROM users WHERE id=?", [id]);
  });
}
