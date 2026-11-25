import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { BOOTSTRAP_SQL } from "./bootstrap";
import * as schema from "./schema";

export type TagWatchDb =
  | PostgresJsDatabase<typeof schema>
  | PgliteDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  tagwatchSql?: ReturnType<typeof postgres>;
  tagwatchPglite?: PGlite;
  tagwatchDb?: TagWatchDb;
  tagwatchBootstrapped?: Promise<void>;
};

let testOverrideDb: TagWatchDb | null = null;

export function setDbForTests(db: TagWatchDb | null) {
  testOverrideDb = db;
}

function getDatabaseUrl(): string {
  return process.env.DATABASE_URL?.trim() || "pglite://.tagwatch-data";
}

function isPgliteUrl(url: string): boolean {
  return url.startsWith("pglite://") || url === "memory://";
}

export async function ensureDbReady(): Promise<TagWatchDb> {
  if (testOverrideDb) return testOverrideDb;

  const db = getDb();

  if (!globalForDb.tagwatchBootstrapped) {
    globalForDb.tagwatchBootstrapped = (async () => {
      if (globalForDb.tagwatchPglite) {
        await globalForDb.tagwatchPglite.exec(BOOTSTRAP_SQL);
      } else if (globalForDb.tagwatchSql) {
        await globalForDb.tagwatchSql.unsafe(BOOTSTRAP_SQL);
      }
    })();
  }

  await globalForDb.tagwatchBootstrapped;
  return db;
}

export function getDb(): TagWatchDb {
  if (testOverrideDb) return testOverrideDb;
  if (globalForDb.tagwatchDb) return globalForDb.tagwatchDb;

  const url = getDatabaseUrl();

  if (isPgliteUrl(url)) {
    const dataDir = url === "memory://" ? undefined : url.replace(/^pglite:\/\//, "");
    const pglite = new PGlite(dataDir);
    const db = drizzlePglite(pglite, { schema });
    globalForDb.tagwatchPglite = pglite;
    globalForDb.tagwatchDb = db;
    return db;
  }

  const sqlClient = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  const db = drizzlePg(sqlClient, { schema });
  globalForDb.tagwatchSql = sqlClient;
  globalForDb.tagwatchDb = db;
  return db;
}

export * from "./schema";
