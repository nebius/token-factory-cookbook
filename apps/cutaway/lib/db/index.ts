import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { seedIfEmpty } from "./seed";

export type DB = Database.Database;

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "db", "migrations");

export function migrate(db: DB): void {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
  const done = new Set(db.prepare("SELECT name FROM _migrations").pluck().all() as string[]);
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(f);
    })();
  }
}

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

const g = globalThis as unknown as { __cutawayDb?: DB };

/** The app database. Opened once per process; seeds itself from seed/*.json when empty. */
export function db(): DB {
  if (!g.__cutawayDb) {
    const file = process.env.CUTAWAY_DB || path.join(ROOT, "data", "cutaway.db");
    g.__cutawayDb = openDb(file);
    seedIfEmpty(g.__cutawayDb);
  }
  return g.__cutawayDb;
}

/** Point the app at another database (tests use an in-memory one). */
export function useDb(d: DB): void {
  g.__cutawayDb = d;
}
