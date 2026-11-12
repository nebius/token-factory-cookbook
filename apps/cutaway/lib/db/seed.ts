import fs from "node:fs";
import path from "node:path";
import type { DB } from "./index";
import { MetaSchema, type Diagram, type Meta } from "@/lib/schema/teardown";
import { nameKey } from "@/lib/slug";

/** A ready teardown exported to JSON, so a fresh clone has a gallery without an API key. */
export type SeedFile = {
  slug: string;
  provider: string;
  model: string;
  input: { kind: "image" | "text"; text?: string; imageBase64?: string; mime?: string };
  meta: Meta;
  parts: { id: string; code: string }[];
  diagrams: Diagram[];
  thumbnailBase64?: string;
};

export const SEED_DIR = path.join(process.cwd(), "seed");

export function importSeed(d: DB, seed: SeedFile): number {
  const meta = MetaSchema.parse(seed.meta);
  return d.transaction(() => {
    const info = d
      .prepare(
        `INSERT INTO teardowns (slug, version, name, name_key, category, summary, status, input_kind, input_hash, meta_json, review_rounds, part_count, provider, model)
         VALUES (?, 1, ?, ?, ?, ?, 'ready', ?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(
        seed.slug,
        meta.device.name,
        nameKey(meta.device.name),
        meta.device.category,
        meta.device.summary,
        seed.input.kind,
        `seed:${seed.slug}`,
        JSON.stringify(meta),
        meta.parts.length,
        seed.provider,
        seed.model,
      );
    const id = Number(info.lastInsertRowid);
    d.prepare("INSERT INTO inputs (teardown_id, image, mime, text) VALUES (?, ?, ?, ?)").run(
      id,
      seed.input.imageBase64 ? Buffer.from(seed.input.imageBase64, "base64") : null,
      seed.input.mime ?? null,
      seed.input.text ?? null,
    );
    const part = d.prepare("INSERT INTO parts (teardown_id, part_id, code, ok) VALUES (?, ?, ?, 1)");
    for (const p of seed.parts) part.run(id, p.id, p.code);
    const dia = d.prepare("INSERT INTO diagrams (teardown_id, kind, title, svg) VALUES (?, ?, ?, ?)");
    for (const g of seed.diagrams) dia.run(id, g.kind, g.title, g.svg);
    if (seed.thumbnailBase64) {
      d.prepare("INSERT INTO thumbnails (teardown_id, image, mime) VALUES (?, ?, 'image/jpeg')").run(id, Buffer.from(seed.thumbnailBase64, "base64"));
    }
    return id;
  })();
}

export function seedIfEmpty(d: DB): void {
  const n = d.prepare("SELECT COUNT(*) FROM teardowns").pluck().get() as number;
  if (n > 0 || !fs.existsSync(SEED_DIR)) return;
  for (const f of fs.readdirSync(SEED_DIR).filter((f) => f.endsWith(".json")).sort()) {
    try {
      importSeed(d, JSON.parse(fs.readFileSync(path.join(SEED_DIR, f), "utf8")));
    } catch (e) {
      console.error(`[seed] skipped ${f}:`, e instanceof Error ? e.message : e);
    }
  }
}
