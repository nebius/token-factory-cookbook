// The database: a local SQLite file by default, Turso when DATABASE_URL points at one. Migrations in ./drizzle
// run once per process on first use, so a fresh checkout or a new deployment needs no separate step.
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import path from "node:path";
import { env } from "@/env";
import * as schema from "./schema";

type Conn = { url: string; client: Client; ready?: Promise<void> };
const globalForDb = globalThis as unknown as { libsql?: Conn };

function getClient(): Conn {
  const cached = globalForDb.libsql;
  if (cached?.url === env.DATABASE_URL) return cached;
  cached?.client.close();
  const next: Conn = { url: env.DATABASE_URL, client: createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN }) };
  globalForDb.libsql = next;
  return next;
}

export const db = drizzle(getClient().client, { schema });
export { schema };

/** Resolves once the tables exist. Every query path awaits this first. */
export function dbReady(): Promise<void> {
  const c = getClient();
  c.ready ??= migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") }).catch((error) => {
    c.ready = undefined;
    throw error;
  });
  return c.ready;
}
