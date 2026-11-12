import { db } from "./index";
import type { Diagram, Identity, Meta } from "@/lib/schema/teardown";

export type Status = "new" | "identifying" | "identified" | "designing" | "designed" | "reviewing" | "ready" | "failed";

type Row = {
  id: number;
  slug: string;
  version: number;
  name: string | null;
  name_key: string | null;
  category: string | null;
  summary: string | null;
  status: Status;
  input_kind: "image" | "text";
  input_hash: string;
  hint: string | null;
  identity_json: string | null;
  meta_json: string | null;
  review_rounds: number;
  part_count: number;
  error: string | null;
  provider: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
};

export type Teardown = Omit<Row, "identity_json" | "meta_json"> & { identity: Identity | null; meta: Meta | null };
export type PartRow = { part_id: string; code: string; ok: number | null; error: string | null; revision: number };

function hydrate(r: Row | undefined): Teardown | null {
  if (!r) return null;
  const { identity_json, meta_json, ...rest } = r;
  return { ...rest, identity: identity_json ? JSON.parse(identity_json) : null, meta: meta_json ? JSON.parse(meta_json) : null };
}

export function createTeardown(o: {
  slug: string;
  version?: number;
  inputKind: "image" | "text";
  inputHash: string;
  image?: Buffer;
  mime?: string;
  text?: string;
  name?: string;
  nameKey?: string;
  category?: string;
  status?: Status;
  identity?: Identity | null;
  hint?: string | null;
}): number {
  const d = db();
  return d.transaction(() => {
    const info = d
      .prepare(
        `INSERT INTO teardowns (slug, version, name, name_key, category, status, input_kind, input_hash, identity_json, hint)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(o.slug, o.version ?? 1, o.name ?? null, o.nameKey ?? null, o.category ?? null, o.status ?? "new", o.inputKind, o.inputHash, o.identity ? JSON.stringify(o.identity) : null, o.hint ?? null);
    const id = Number(info.lastInsertRowid);
    d.prepare("INSERT INTO inputs (teardown_id, image, mime, text) VALUES (?, ?, ?, ?)").run(id, o.image ?? null, o.mime ?? null, o.text ?? null);
    return id;
  })();
}

export function getTeardown(id: number): Teardown | null {
  return hydrate(db().prepare("SELECT * FROM teardowns WHERE id = ?").get(id) as Row | undefined);
}

/** The newest ready version of a slug (or a specific version). */
export function getBySlug(slug: string, version?: number): Teardown | null {
  const row = version
    ? db().prepare("SELECT * FROM teardowns WHERE slug = ? AND version = ?").get(slug, version)
    : db().prepare("SELECT * FROM teardowns WHERE slug = ? AND status = 'ready' ORDER BY version DESC LIMIT 1").get(slug);
  return hydrate(row as Row | undefined);
}

export function listVersions(slug: string): { id: number; version: number; status: Status; created_at: string; provider: string | null }[] {
  return db().prepare("SELECT id, version, status, created_at, provider FROM teardowns WHERE slug = ? ORDER BY version DESC").all(slug) as never;
}

export function findReadyByNameKey(key: string): Teardown | null {
  return hydrate(db().prepare("SELECT * FROM teardowns WHERE name_key = ? AND status = 'ready' ORDER BY version DESC LIMIT 1").get(key) as Row | undefined);
}

/** An unfinished teardown for the same input, so a second upload resumes instead of paying again. */
export function findOpenByInputHash(hash: string): Teardown | null {
  return hydrate(
    db().prepare("SELECT * FROM teardowns WHERE input_hash = ? AND status NOT IN ('failed') ORDER BY id DESC LIMIT 1").get(hash) as Row | undefined,
  );
}

export function slugTaken(slug: string, exceptNameKey?: string): boolean {
  const row = db().prepare("SELECT name_key FROM teardowns WHERE slug = ? LIMIT 1").get(slug) as { name_key: string | null } | undefined;
  return !!row && row.name_key !== exceptNameKey;
}

export function nextVersion(slug: string): number {
  const v = db().prepare("SELECT MAX(version) FROM teardowns WHERE slug = ?").pluck().get(slug) as number | null;
  return (v ?? 0) + 1;
}

type Patch = Partial<Pick<Row, "slug" | "version" | "name" | "name_key" | "category" | "summary" | "status" | "hint" | "review_rounds" | "part_count" | "error" | "provider" | "model">> & {
  identity?: Identity | null;
  meta?: Meta | null;
};

export function updateTeardown(id: number, patch: Patch): void {
  const { identity, meta, ...cols } = patch;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(cols)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (identity !== undefined) {
    sets.push("identity_json = ?");
    vals.push(identity ? JSON.stringify(identity) : null);
  }
  if (meta !== undefined) {
    sets.push("meta_json = ?");
    vals.push(meta ? JSON.stringify(meta) : null);
  }
  if (!sets.length) return;
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  db().prepare(`UPDATE teardowns SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

export function getInput(id: number): { image: Buffer | null; mime: string | null; text: string | null } | null {
  return (db().prepare("SELECT image, mime, text FROM inputs WHERE teardown_id = ?").get(id) as never) ?? null;
}

export function getParts(id: number): PartRow[] {
  return db().prepare("SELECT part_id, code, ok, error, revision FROM parts WHERE teardown_id = ? ORDER BY rowid").all(id) as PartRow[];
}

/** Insert or replace builders; a replaced builder bumps its revision and clears its last result. */
export function upsertParts(id: number, parts: { id: string; code: string }[]): void {
  const d = db();
  const stmt = d.prepare(
    `INSERT INTO parts (teardown_id, part_id, code) VALUES (?, ?, ?)
     ON CONFLICT (teardown_id, part_id) DO UPDATE SET code = excluded.code, ok = NULL, error = NULL, revision = revision + 1`,
  );
  d.transaction(() => {
    for (const p of parts) stmt.run(id, p.id, p.code);
  })();
}

export function deleteParts(id: number): void {
  db().prepare("DELETE FROM parts WHERE teardown_id = ?").run(id);
}

/** A cheap fingerprint of a teardown's metadata and parts, so watchers only download them when they change. */
export function partsVersion(id: number): string {
  const r = db()
    .prepare("SELECT t.updated_at AS u, COUNT(p.part_id) AS n, COALESCE(SUM(p.revision), 0) AS rev FROM teardowns t LEFT JOIN parts p ON p.teardown_id = t.id WHERE t.id = ? GROUP BY t.id")
    .get(id) as { u: string; n: number; rev: number } | undefined;
  return r ? `${r.u}|${r.n}|${r.rev}` : "";
}

export function setPartResults(id: number, results: { id: string; ok: boolean; error?: string | null }[]): void {
  const d = db();
  const stmt = d.prepare("UPDATE parts SET ok = ?, error = ? WHERE teardown_id = ? AND part_id = ?");
  d.transaction(() => {
    for (const r of results) stmt.run(r.ok ? 1 : 0, r.error ?? null, id, r.id);
  })();
}

export function getDiagrams(id: number): Diagram[] {
  return db().prepare("SELECT kind, title, svg FROM diagrams WHERE teardown_id = ?").all(id) as Diagram[];
}

export function saveDiagrams(id: number, diagrams: Diagram[]): void {
  const d = db();
  const stmt = d.prepare("INSERT OR REPLACE INTO diagrams (teardown_id, kind, title, svg) VALUES (?, ?, ?, ?)");
  d.transaction(() => {
    for (const g of diagrams) stmt.run(id, g.kind, g.title, g.svg);
  })();
}

export function setThumbnail(id: number, image: Buffer, mime: string): void {
  db().prepare("INSERT OR REPLACE INTO thumbnails (teardown_id, image, mime) VALUES (?, ?, ?)").run(id, image, mime);
}

export function getThumbnail(id: number): { image: Buffer; mime: string } | null {
  return (db().prepare("SELECT image, mime FROM thumbnails WHERE teardown_id = ?").get(id) as never) ?? null;
}

export function getIdentityCache(hash: string): Identity | null {
  const s = db().prepare("SELECT identity_json FROM identify_cache WHERE input_hash = ?").pluck().get(hash) as string | undefined;
  return s ? JSON.parse(s) : null;
}

export function setIdentityCache(hash: string, identity: Identity): void {
  db().prepare("INSERT OR REPLACE INTO identify_cache (input_hash, identity_json) VALUES (?, ?)").run(hash, JSON.stringify(identity));
}

export type LibraryCard = {
  id: number;
  slug: string;
  version: number;
  name: string;
  category: string;
  summary: string;
  part_count: number;
  provider: string | null;
  created_at: string;
  updated_at: string;
  has_thumb: number;
  bookmarked: number;
  parts_opened: number;
  steps_done: number;
  quiz_answered: number;
  step_count: number;
  quiz_count: number;
  progress_at: string | null;
};

/** The newest ready version of every device, with study progress for the dashboard. */
export function listLibrary(o: { q?: string; category?: string; bookmarked?: boolean; sort?: "recent" | "name" | "parts" | "studied" } = {}): LibraryCard[] {
  const where = ["t.status = 'ready'", "t.version = (SELECT MAX(version) FROM teardowns x WHERE x.slug = t.slug AND x.status = 'ready')"];
  const vals: unknown[] = [];
  if (o.q) {
    where.push("(t.name LIKE ? OR t.summary LIKE ? OR t.meta_json LIKE ?)");
    const like = `%${o.q}%`;
    vals.push(like, like, like);
  }
  if (o.category) {
    where.push("t.category = ?");
    vals.push(o.category);
  }
  if (o.bookmarked) where.push("b.slug IS NOT NULL");
  const order =
    o.sort === "name" ? "t.name COLLATE NOCASE" : o.sort === "parts" ? "t.part_count DESC" : o.sort === "studied" ? "COALESCE(p.updated_at, '') DESC" : "t.updated_at DESC";
  return db()
    .prepare(
      `SELECT t.id, t.slug, t.version, t.name, t.category, t.summary, t.part_count, t.provider, t.created_at, t.updated_at,
              (th.teardown_id IS NOT NULL) AS has_thumb, (b.slug IS NOT NULL) AS bookmarked,
              COALESCE(json_array_length(p.parts_opened), 0) AS parts_opened,
              COALESCE(json_array_length(p.steps_done), 0) AS steps_done,
              COALESCE((SELECT COUNT(*) FROM json_each(p.quiz)), 0) AS quiz_answered,
              COALESCE(json_array_length(t.meta_json, '$.steps'), 0) AS step_count,
              COALESCE(json_array_length(t.meta_json, '$.study.quiz'), 0) AS quiz_count,
              p.updated_at AS progress_at
       FROM teardowns t
       LEFT JOIN thumbnails th ON th.teardown_id = t.id
       LEFT JOIN bookmarks b ON b.slug = t.slug
       LEFT JOIN progress p ON p.slug = t.slug
       WHERE ${where.join(" AND ")}
       ORDER BY ${order}`,
    )
    .all(...vals) as LibraryCard[];
}

/** Unfinished generations, so the dashboard can offer to resume them. */
export function listInProgress(): { id: number; name: string | null; status: Status; updated_at: string; error: string | null }[] {
  return db()
    .prepare("SELECT id, name, status, updated_at, error FROM teardowns WHERE status NOT IN ('ready') ORDER BY updated_at DESC LIMIT 12")
    .all() as never;
}

export function deleteTeardown(id: number): void {
  db().prepare("DELETE FROM teardowns WHERE id = ?").run(id);
}
