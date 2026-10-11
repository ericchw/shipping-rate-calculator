import "server-only";
import { randomUUID } from "node:crypto";
import { db, type Store } from "./db";
import { profileSchema, type Profile } from "./schemas";
import { AppError } from "./errors";
const fields = [
  "contact_name",
  "company",
  "address_line1",
  "address_line2",
  "city",
  "region",
  "postal_code",
  "country_code",
  "phone",
  "email",
] as const;
export class Profiles {
  constructor(private store: Store = db()) {}
  async list(user: string) {
    return (
      await this.store.query<Profile>(
        "SELECT * FROM ship_from_profiles WHERE user_id=? ORDER BY is_default DESC,profile_name",
        [user],
      )
    ).map((p) => ({ ...p, is_default: !!p.is_default }));
  }
  async get(user: string, id: string) {
    const p = (
      await this.store.query<Profile>(
        "SELECT * FROM ship_from_profiles WHERE user_id=? AND id=?",
        [user, id],
      )
    )[0];
    if (!p) throw new AppError(404, "NOT_FOUND", "Profile not found");
    return { ...p, is_default: !!p.is_default };
  }
  async save(user: string, input: unknown, id?: string) {
    const value = profileSchema.parse(input);
    const now = new Date().toISOString();
    const key = id ?? randomUUID();
    try {
      await this.store.transaction(async (tx) => {
        await tx.query("UPDATE users SET id=id WHERE id=?", [user]);
        if (
          id &&
          !(
            await tx.query(
              "SELECT id FROM ship_from_profiles WHERE user_id=? AND id=?",
              [user, id],
            )
          ).length
        )
          throw new AppError(404, "NOT_FOUND", "Profile not found");
        if (value.is_default)
          await tx.query(
            "UPDATE ship_from_profiles SET is_default=0,updated_at=? WHERE user_id=?",
            [now, user],
          );
        const vals = fields.map((f) => value.address[f]);
        if (id)
          await tx.query(
            `UPDATE ship_from_profiles SET profile_name=?,${fields.map((f) => `${f}=?`).join(",")},is_default=?,updated_at=? WHERE user_id=? AND id=?`,
            [
              value.profile_name,
              ...vals,
              Number(value.is_default),
              now,
              user,
              id,
            ],
          );
        else
          await tx.query(
            `INSERT INTO ship_from_profiles (id,user_id,profile_name,${fields.join(",")},is_default,created_at,updated_at) VALUES (${Array(16).fill("?").join(",")})`,
            [
              key,
              user,
              value.profile_name,
              ...vals,
              Number(value.is_default),
              now,
              now,
            ],
          );
      });
    } catch (e) {
      if (
        e instanceof Error &&
        /unique|constraint.*profiles_name/i.test(e.message)
      )
        throw new AppError(
          409,
          "NAME_CONFLICT",
          "A profile with that name already exists",
        );
      throw e;
    }
    return this.get(user, key);
  }
  async setDefault(user: string, id: string) {
    await this.store.transaction(async (tx) => {
      await tx.query("UPDATE users SET id=id WHERE id=?", [user]);
      if (
        !(
          await tx.query(
            "SELECT id FROM ship_from_profiles WHERE id=? AND user_id=?",
            [id, user],
          )
        ).length
      )
        throw new AppError(404, "NOT_FOUND", "Profile not found");
      const now = new Date().toISOString();
      await tx.query(
        "UPDATE ship_from_profiles SET is_default=0,updated_at=? WHERE user_id=?",
        [now, user],
      );
      await tx.query(
        "UPDATE ship_from_profiles SET is_default=1,updated_at=? WHERE user_id=? AND id=?",
        [now, user, id],
      );
    });
    return this.get(user, id);
  }
  async delete(user: string, id: string) {
    await this.get(user, id);
    await this.store.query(
      "DELETE FROM ship_from_profiles WHERE user_id=? AND id=?",
      [user, id],
    );
  }
}
