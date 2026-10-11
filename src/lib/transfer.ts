import { Store } from "./db";
type UserRecord = {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: string;
};
type ProfileRecord = Record<string, string | number>;
const profileFields = [
  "id",
  "user_id",
  "profile_name",
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
  "is_default",
  "created_at",
  "updated_at",
] as const;
export async function transfer(source: Store, target: Store) {
  await target.migrate();
  // Caller stops application writes first. A source transaction ensures a
  // consistent snapshot; Postgres takes table locks for the related account and profile tables.
  const snapshot = await source.transaction(async (tx) => {
    if (source.provider === "postgresql")
      await tx.query("LOCK TABLE users,ship_from_profiles,account_access IN SHARE MODE");
    return {
      users: await tx.query<UserRecord>(
        "SELECT id,email,password_hash,role,created_at FROM users",
      ),
      access: await tx.query<{ user_id: string; web_access: number; api_access: number }>("SELECT user_id,web_access,api_access FROM account_access"),
      profiles: await tx.query<ProfileRecord>(
        `SELECT ${profileFields.join(",")} FROM ship_from_profiles`,
      ),
    };
  });
  const owners = new Set(snapshot.users.map((u) => u.id));
  const names = new Set<string>();
  const defaults = new Set<string>();
  for (const p of snapshot.profiles) {
    if (!owners.has(String(p.user_id)))
      throw new Error("Source contains an orphan profile");
    const name =
      String(p.user_id) +
      ":" +
      String(p.profile_name).normalize("NFKC").toLowerCase();
    if (names.has(name))
      throw new Error("Source contains conflicting profile names");
    names.add(name);
    if (Number(p.is_default)) {
      if (defaults.has(String(p.user_id)))
        throw new Error("Source contains conflicting defaults");
      defaults.add(String(p.user_id));
    }
  }
  await target.transaction(async (tx) => {
    if (target.provider === "postgresql")
      await tx.query(
        "LOCK TABLE users,ship_from_profiles,sessions,account_access IN ACCESS EXCLUSIVE MODE",
      );
    for (const table of ["users", "ship_from_profiles", "sessions", "account_access"])
      if ((await tx.query(`SELECT 1 FROM ${table} LIMIT 1`)).length)
        throw new Error("Target database must be empty");
    for (const u of snapshot.users)
      await tx.query(
        "INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)",
        [u.id, u.email, u.password_hash, u.role, u.created_at],
      );
    for (const a of snapshot.access)
      await tx.query("INSERT INTO account_access (user_id,web_access,api_access) VALUES (?,?,?)", [a.user_id, a.web_access, a.api_access]);
    for (const p of snapshot.profiles)
      await tx.query(
        `INSERT INTO ship_from_profiles (${profileFields.join(",")}) VALUES (${profileFields.map(() => "?").join(",")})`,
        profileFields.map((f) => (f === "is_default" ? Number(p[f]) : p[f])),
      );
  });
  return { users: snapshot.users.length, profiles: snapshot.profiles.length };
}
