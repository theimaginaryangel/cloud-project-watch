import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { BOOTSTRAP_SQL } from "./bootstrap";
import * as schema from "./schema";

export type CloudProjectWatchDb =
  | PostgresJsDatabase<typeof schema>
  | PgliteDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  cpwSql?: ReturnType<typeof postgres>;
  cpwPglite?: PGlite;
  cpwDb?: CloudProjectWatchDb;
  cpwBootstrapped?: Promise<void>;
};

let testOverrideDb: CloudProjectWatchDb | null = null;

export function setDbForTests(db: CloudProjectWatchDb | null) {
  testOverrideDb = db;
}

function getDatabaseUrl(): string {
  return process.env.DATABASE_URL?.trim() || "pglite://.cpw-data";
}

function isPgliteUrl(url: string): boolean {
  return url.startsWith("pglite://") || url === "memory://";
}

export async function ensureDbReady(): Promise<CloudProjectWatchDb> {
  if (testOverrideDb) return testOverrideDb;

  const db = getDb();

  if (!globalForDb.cpwBootstrapped) {
    globalForDb.cpwBootstrapped = (async () => {
      if (globalForDb.cpwPglite) {
        await globalForDb.cpwPglite.exec(BOOTSTRAP_SQL);
      } else if (globalForDb.cpwSql) {
        await globalForDb.cpwSql.unsafe(BOOTSTRAP_SQL);
      }
    })();
  }

  await globalForDb.cpwBootstrapped;
  return db;
}

export function getDb(): CloudProjectWatchDb {
  if (testOverrideDb) return testOverrideDb;
  if (globalForDb.cpwDb) return globalForDb.cpwDb;

  const url = getDatabaseUrl();

  if (isPgliteUrl(url)) {
    const dataDir = url === "memory://" ? undefined : url.replace(/^pglite:\/\//, "");
    const pglite = new PGlite(dataDir);
    const db = drizzlePglite(pglite, { schema });
    globalForDb.cpwPglite = pglite;
    globalForDb.cpwDb = db;
    return db;
  }

  const sqlClient = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  const db = drizzlePg(sqlClient, { schema });
  globalForDb.cpwSql = sqlClient;
  globalForDb.cpwDb = db;
  return db;
}

export * from "./schema";
