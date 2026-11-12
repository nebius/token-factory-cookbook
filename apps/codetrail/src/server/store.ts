// Codetrail's store, all in SQLite (a local file, or Turso when hosted): JSON artifacts by key (facts, maps,
// tours, answers, docs), every text file of every commit read (with a full-text index), and one row per
// priced model call. After the first read of a commit, nothing needs GitHub or the model again.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { CallRecord } from "@/lib/schemas";
import { db, dbReady, schema } from "@/server/db";
import type { RepoFile, Snapshot } from "@/server/repo/github";

export async function getJSON<T>(key: string): Promise<T | null> {
  await dbReady();
  const row = await db.query.artifacts.findFirst({ where: eq(schema.artifacts.key, key) });
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function putJSON(key: string, value: unknown): Promise<void> {
  await dbReady();
  const v = JSON.stringify(value);
  await db
    .insert(schema.artifacts)
    .values({ key, value: v })
    .onConflictDoUpdate({ target: schema.artifacts.key, set: { value: v, updatedAt: new Date() } });
}

/** Keys matching a SQL LIKE pattern, with when each was last written: e.g. every stored map. */
export async function keysLike(pattern: string): Promise<{ key: string; at: number }[]> {
  await dbReady();
  const rows = await db.select({ key: schema.artifacts.key, at: schema.artifacts.updatedAt }).from(schema.artifacts).where(sql`${schema.artifacts.key} LIKE ${pattern}`);
  return rows.map((r) => ({ key: r.key, at: r.at instanceof Date ? r.at.getTime() : Number(r.at) }));
}

// --- A commit's files ---------------------------------------------------------------------------------------
type SnapshotMeta = Pick<Snapshot, "images" | "skipped"> & { files: number };

/** Stores text files under a commit key (a whole snapshot, or just a pull request's changed files). */
export async function saveFiles(commit: string, files: RepoFile[]): Promise<void> {
  await dbReady();
  for (let i = 0; i < files.length; i += 200) {
    const chunk = files.slice(i, i + 200).map((f) => ({ commit, path: f.path, text: f.text, lines: f.lines }));
    await db.insert(schema.repoFiles).values(chunk).onConflictDoNothing();
  }
}

export async function saveSnapshot(commit: string, snapshot: Snapshot): Promise<void> {
  await saveFiles(commit, snapshot.files);
  // Written last: its presence means every file row is in.
  await putJSON(`${commit}/snapshot.json`, { images: snapshot.images, skipped: snapshot.skipped, files: snapshot.files.length } satisfies SnapshotMeta);
}

export async function loadSnapshot(commit: string): Promise<Snapshot | null> {
  const meta = await getJSON<SnapshotMeta>(`${commit}/snapshot.json`);
  if (!meta) return null;
  const rows = await db.select({ path: schema.repoFiles.path, text: schema.repoFiles.text, lines: schema.repoFiles.lines }).from(schema.repoFiles).where(eq(schema.repoFiles.commit, commit)).orderBy(asc(schema.repoFiles.path));
  return { files: rows as RepoFile[], images: meta.images, skipped: meta.skipped };
}

export async function fileFromStore(commit: string, path: string): Promise<string | null> {
  await dbReady();
  const row = await db.query.repoFiles.findFirst({ where: and(eq(schema.repoFiles.commit, commit), eq(schema.repoFiles.path, path)), columns: { text: true } });
  return row?.text ?? null;
}

/** Files whose path or text contains `needle` (FTS5 trigram index; plain LIKE for 1-2 characters). */
export async function searchFiles(commit: string, needle: string, limit = 40): Promise<{ path: string; text: string }[]> {
  await dbReady();
  if (needle.length >= 3) {
    const match = `"${needle.replace(/"/g, '""')}"`;
    const ids = await db.all<{ rowid: number }>(sql`SELECT rowid FROM repo_files_fts WHERE repo_files_fts MATCH ${match} AND commit_key = ${commit} LIMIT ${limit}`);
    if (!ids.length) return [];
    return db
      .select({ path: schema.repoFiles.path, text: schema.repoFiles.text })
      .from(schema.repoFiles)
      .where(inArray(sql`rowid`, ids.map((r) => r.rowid)));
  }
  const like = `%${needle.replace(/[%_]/g, "")}%`;
  return db
    .select({ path: schema.repoFiles.path, text: schema.repoFiles.text })
    .from(schema.repoFiles)
    .where(and(eq(schema.repoFiles.commit, commit), sql`(${schema.repoFiles.path} LIKE ${like} OR ${schema.repoFiles.text} LIKE ${like})`))
    .limit(limit);
}

// --- The cost ledger ----------------------------------------------------------------------------------------
export async function appendCall(commit: string, record: CallRecord): Promise<void> {
  await dbReady();
  await db.insert(schema.calls).values({ id: record.id, commit, record: JSON.stringify(record), at: record.at }).onConflictDoNothing();
}

export async function getCalls(commit: string): Promise<CallRecord[]> {
  await dbReady();
  const rows = await db.select({ record: schema.calls.record }).from(schema.calls).where(eq(schema.calls.commit, commit)).orderBy(asc(schema.calls.at));
  return rows.map((r) => JSON.parse(r.record) as CallRecord);
}
