import { db } from "./index";

export type Progress = { partsOpened: string[]; stepsDone: number[]; quiz: Record<string, number> };

export function isBookmarked(slug: string): boolean {
  return !!db().prepare("SELECT 1 FROM bookmarks WHERE slug = ?").get(slug);
}

export function setBookmark(slug: string, on: boolean): void {
  if (on) db().prepare("INSERT OR IGNORE INTO bookmarks (slug) VALUES (?)").run(slug);
  else db().prepare("DELETE FROM bookmarks WHERE slug = ?").run(slug);
}

export function getNotes(slug: string): Record<string, string> {
  const rows = db().prepare("SELECT part_id, body FROM notes WHERE slug = ?").all(slug) as { part_id: string; body: string }[];
  return Object.fromEntries(rows.map((r) => [r.part_id, r.body]));
}

export function setNote(slug: string, partId: string, body: string): void {
  if (!body.trim()) {
    db().prepare("DELETE FROM notes WHERE slug = ? AND part_id = ?").run(slug, partId);
    return;
  }
  db()
    .prepare(
      `INSERT INTO notes (slug, part_id, body) VALUES (?, ?, ?)
       ON CONFLICT (slug, part_id) DO UPDATE SET body = excluded.body, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .run(slug, partId, body);
}

export function getProgress(slug: string): Progress {
  const r = db().prepare("SELECT parts_opened, steps_done, quiz FROM progress WHERE slug = ?").get(slug) as
    | { parts_opened: string; steps_done: string; quiz: string }
    | undefined;
  if (!r) return { partsOpened: [], stepsDone: [], quiz: {} };
  return { partsOpened: JSON.parse(r.parts_opened), stepsDone: JSON.parse(r.steps_done), quiz: JSON.parse(r.quiz) };
}

/** Merge new progress in: opened parts and finished steps only grow; quiz answers overwrite per question. */
export function addProgress(
  slug: string,
  add: { partsOpened?: string[]; stepsDone?: number[]; quiz?: Record<string, number>; reset?: boolean; resetQuiz?: boolean },
): Progress {
  const cur = add.reset ? { partsOpened: [], stepsDone: [], quiz: {} } : getProgress(slug);
  if (add.resetQuiz) cur.quiz = {};
  const next: Progress = {
    partsOpened: [...new Set([...cur.partsOpened, ...(add.partsOpened ?? [])])],
    stepsDone: [...new Set([...cur.stepsDone, ...(add.stepsDone ?? [])])].sort((a, b) => a - b),
    quiz: { ...cur.quiz, ...(add.quiz ?? {}) },
  };
  db()
    .prepare(
      `INSERT INTO progress (slug, parts_opened, steps_done, quiz) VALUES (?, ?, ?, ?)
       ON CONFLICT (slug) DO UPDATE SET parts_opened = excluded.parts_opened, steps_done = excluded.steps_done,
         quiz = excluded.quiz, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .run(slug, JSON.stringify(next.partsOpened), JSON.stringify(next.stepsDone), JSON.stringify(next.quiz));
  return next;
}
