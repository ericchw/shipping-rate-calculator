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
};
const createSchema = z.object(fields).strict();
const editSchema = z.object(fields).partial().strict().refine(value => Object.keys(value).length > 0, "No changes provided");
export type Account = { id: string; email: string; role: User["role"]; webAccess: boolean; apiAccess: boolean; created_at: string };
type AccountRow = Omit<Account, "webAccess" | "apiAccess"> & { web_access: number; api_access: number };
const select = "SELECT u.id,u.email,u.role,u.created_at,COALESCE(a.web_access,1) AS web_access,COALESCE(a.api_access,1) AS api_access FROM users u LEFT JOIN account_access a ON a.user_id=u.id";
const publicAccount = (row: AccountRow): Account => ({ id: row.id, email: row.email, role: row.role, created_at: row.created_at, webAccess: !!row.web_access, apiAccess: !!row.api_access });
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
    if ((await tx.query<{ id: string }>("SELECT id FROM users WHERE lower(email)=lower(?)", [email])).some(row => row.id !== id))
      throw new AppError(409, "EMAIL_CONFLICT", "An account with this email already exists");
    if (old?.role === "admin" && old.web_access && (role !== "admin" || !web)) await preserveAdmin(tx, id!);
    const accountId = id ?? randomUUID();
    if (id) {
      await tx.query("UPDATE users SET email=?,role=? WHERE id=?", [email, role, id]);
      if (hash) await tx.query("UPDATE users SET password_hash=? WHERE id=?", [hash, id]);
      await tx.query("DELETE FROM sessions WHERE user_id=?", [id]);
    } else await tx.query("INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)", [accountId, email, hash!, role, new Date().toISOString()]);
    await tx.query("INSERT INTO account_access (user_id,web_access,api_access) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET web_access=excluded.web_access,api_access=excluded.api_access", [accountId, Number(web), Number(api)]);
    return publicAccount((await tx.query<AccountRow>(`${select} WHERE u.id=?`, [accountId]))[0]);
  });
}
async function preserveAdmin(tx: Connection, id: string) {
  const others = await tx.query<{ id: string }>("SELECT u.id FROM users u LEFT JOIN account_access a ON a.user_id=u.id WHERE u.role='admin' AND COALESCE(a.web_access,1)=1 AND u.id<>?", [id]);
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
