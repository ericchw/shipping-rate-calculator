import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { Pool, type PoolClient } from "pg";
import { chmodSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
export type Row = Record<string, unknown>;
export interface Connection {
  query<T = Row>(sql: string, values?: unknown[]): Promise<T[]>;
}
export class Store implements Connection {
  private sqlite?: DatabaseSync;
  private pool?: Pool;
  private tail: Promise<unknown> = Promise.resolve();
  readonly provider: string;
  constructor(
    provider = process.env.DATABASE_PROVIDER ?? "postgresql",
    url = process.env.DATABASE_URL ??
      (provider === "sqlite" ? "file:./data/shipping.db" : ""),
  ) {
    this.provider = provider;
    if (provider === "sqlite") {
      if (!url.startsWith("file:"))
        throw new Error("SQLite DATABASE_URL must start with file:");
      const file = url.slice(5);
      if (file !== ":memory:")
        mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      this.sqlite = new DatabaseSync(file);
      if (file !== ":memory:") chmodSync(file, 0o600);
      this.sqlite.exec(
        "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
      );
    } else if (provider === "postgresql") {
      if (!/^postgres(ql)?:\/\//.test(url))
        throw new Error("PostgreSQL DATABASE_URL required");
      this.pool = new Pool({ connectionString: url, max: 10 });
    } else throw new Error("Unsupported DATABASE_PROVIDER");
  }
  private async run<T>(
    sql: string,
    values: unknown[] = [],
    client?: PoolClient,
  ): Promise<T[]> {
    if (this.sqlite) {
      const statement = this.sqlite.prepare(sql);
      return (
        statement.columns().length
          ? statement.all(...(values as SQLInputValue[]))
          : (statement.run(...(values as SQLInputValue[])), [])
      ) as T[];
    }
    let i = 0;
    return (
      await (client ?? this.pool!).query(
        sql.replace(/\?/g, () => `$${++i}`),
        values,
      )
    ).rows as T[];
  }
  async query<T = Row>(sql: string, values: unknown[] = []): Promise<T[]> {
    if (this.sqlite) {
      await this.tail;
    }
    return this.run<T>(sql, values);
  }
  async transaction<T>(fn: (tx: Connection) => Promise<T>): Promise<T> {
    if (this.sqlite) {
      const work = this.tail.then(async () => {
        this.sqlite!.exec("BEGIN IMMEDIATE");
        try {
          const result = await fn({
            query: <R = Row>(s: string, v?: unknown[]) => this.run<R>(s, v),
          });
          this.sqlite!.exec("COMMIT");
          return result;
        } catch (e) {
          this.sqlite!.exec("ROLLBACK");
          throw e;
        }
      });
      this.tail = work.catch(() => {});
      return work;
    }
    const client = await this.pool!.connect();
    try {
      await client.query("BEGIN");
      const result = await fn({
        query: <R = Row>(s: string, v?: unknown[]) => this.run<R>(s, v, client),
      });
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async migrate() {
    const directory = path.resolve(`migrations/${this.provider}`);
    for (const file of readdirSync(directory).filter((file) => /^\d+.*\.sql$/.test(file)).sort()) {
      const sql = readFileSync(path.join(directory, file), "utf8");
      if (this.sqlite) this.sqlite.exec(sql);
      else await this.pool!.query(sql);
    }
  }
  async close() {
    this.sqlite?.close();
    await this.pool?.end();
  }
}
let singleton: Store | undefined;
export function db() {
  return (singleton ??= new Store());
}
