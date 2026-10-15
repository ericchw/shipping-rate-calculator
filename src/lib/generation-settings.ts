import "server-only";
import { db } from "./db";
import { assertAdmin, type User } from "./auth";
import type { AppMode } from "./app-routes";
import { authorizeAdmin } from "./groups";

export async function generationEnabled(mode: AppMode, groupId?: string | null) {
  if (!groupId) return false;
  const [row] = await db().query<{ enabled: number }>("SELECT enabled FROM group_generation_settings WHERE group_id=? AND mode=?", [groupId, mode]);
  return row?.enabled === 1;
}
export async function saveGenerationSetting(actor: User, mode: AppMode, enabled: boolean, groupId: string) {
  assertAdmin(actor);
  return db().transaction(async (tx) => {
    await authorizeAdmin(tx, actor);
    await tx.query("INSERT INTO group_generation_settings(group_id,mode,enabled) VALUES (?,?,?) ON CONFLICT(group_id,mode) DO UPDATE SET enabled=excluded.enabled", [groupId, mode, enabled ? 1 : 0]);
    return { enabled };
  });
}
