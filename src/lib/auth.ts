import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "./db";
import { AppError } from "./errors";
const derive = promisify(scrypt);
export type User = {
  id: string;
  email: string;
  role: "user" | "operator" | "admin";
  webAccess?: boolean;
  apiAccess?: boolean;
  channel?: "web" | "api";
};
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [salt, hex] = hash.split(":");
  const key = (await derive(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  return expected.length === key.length && timingSafeEqual(key, expected);
}
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export const cookieName = "shipping_session";
export function sessionCookie(token: string, maxAge = 28800) {
  return `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.APP_ENV === "production" || process.env.APP_ENV === "uat" ? "; Secure" : ""}`;
}
function token(req: Request) {
  return req.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}
export async function currentUser(req: Request): Promise<User | null> {
  const t = token(req);
  if (!t || !/^[a-f0-9]{64}$/.test(t)) return null;
  const row = (await db().query<User & { web_access: number; api_access: number }>(
    "SELECT u.id,u.email,u.role,COALESCE(a.web_access,1) AS web_access,COALESCE(a.api_access,1) AS api_access,COALESCE(c.channel,'web') AS channel FROM users u JOIN sessions s ON s.user_id=u.id LEFT JOIN account_access a ON a.user_id=u.id LEFT JOIN session_channels c ON c.token_hash=s.token_hash WHERE s.token_hash=? AND s.expires_at>?",
    [digest(t), new Date().toISOString()],
  ))[0];
  if (!row || !(row.channel === "api" ? row.api_access : row.web_access)) return null;
  return { id: row.id, email: row.email, role: row.role, webAccess: !!row.web_access, apiAccess: !!row.api_access, channel: row.channel };
}
export async function requireUser(req: Request) {
  const user = await currentUser(req);
  if (!user) throw new AppError(401, "UNAUTHORIZED", "Sign in to continue");
  return user;
}
export async function login(email: string, password: string, channel: "web" | "api" = "api") {
  const user = (
    await db().query<User & { password_hash: string; web_access: number; api_access: number }>(
      "SELECT u.*,COALESCE(a.web_access,1) AS web_access,COALESCE(a.api_access,1) AS api_access FROM users u LEFT JOIN account_access a ON a.user_id=u.id WHERE u.email=?",
      [email.toLowerCase()],
    )
  )[0];
  const hash =
    user?.password_hash ??
    "00000000000000000000000000000000:" + "00".repeat(64);
  if (!(await verifyPassword(password, hash)) || !user)
    throw new AppError(401, "INVALID_LOGIN", "Invalid email or password");
  await db().query("DELETE FROM sessions WHERE expires_at<=?", [new Date().toISOString()]);
  return db().transaction(async (tx) => {
    // Serialize with account edits; verification happened before taking the lock.
    await tx.query("UPDATE users SET id=id WHERE id=?", [user.id]);
    const fresh = (await tx.query<User & { password_hash: string; web_access: number; api_access: number }>(
      "SELECT u.*,COALESCE(a.web_access,1) AS web_access,COALESCE(a.api_access,1) AS api_access FROM users u LEFT JOIN account_access a ON a.user_id=u.id WHERE u.id=?", [user.id],
    ))[0];
    if (!fresh || fresh.password_hash !== user.password_hash)
      throw new AppError(401, "INVALID_LOGIN", "Invalid email or password");
    if (!(channel === "web" ? fresh.web_access : fresh.api_access))
      throw new AppError(403, "ACCESS_DENIED", `${channel === "web" ? "Web" : "API"} access is disabled for this account`);
    const t = randomBytes(32).toString("hex");
    await tx.query("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)", [digest(t), fresh.id, new Date(Date.now() + 28800000).toISOString()]);
    await tx.query("INSERT INTO session_channels (token_hash,channel) VALUES (?,?)", [digest(t), channel]);
    return { token: t, user: { id: fresh.id, email: fresh.email, role: fresh.role, webAccess: !!fresh.web_access, apiAccess: !!fresh.api_access, channel } };
  });
}
export async function logout(req: Request) {
  const t = token(req);
  if (t)
    await db().query("DELETE FROM sessions WHERE token_hash=?", [digest(t)]);
}
export function apiKeyValid(req: Request) {
  const key = process.env.APP_API_KEY;
  const value = req.headers.get("authorization") ?? "";
  return (
    !!key &&
    key.length >= 32 &&
    timingSafeEqual(
      createHash("sha256").update(value).digest(),
      createHash("sha256").update(`Bearer ${key}`).digest(),
    )
  );
}

export function assertAdmin(user: User) {
  if (user.role !== "admin" || user.webAccess === false || user.channel === "api")
    throw new AppError(403, "ADMIN_REQUIRED", "Administrator web access is required");
}
