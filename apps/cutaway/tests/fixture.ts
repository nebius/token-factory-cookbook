import fs from "node:fs";
import path from "node:path";
import { extractJson, parseTagged } from "@/lib/kimi/parse";
import { MetaSchema, type Meta } from "@/lib/schema/teardown";

export const FIXTURES = path.join(__dirname, "..", "fixtures", "kimi");

export function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

export function deskFan(): { text: string; meta: Meta; parts: { id: string; code: string }[] } {
  const text = readFixture("desk-fan.design.txt");
  const blocks = parseTagged(text);
  const metaBlock = blocks.find((b) => b.tag === "meta");
  if (!metaBlock) throw new Error("fixture has no meta");
  const meta = MetaSchema.parse(extractJson(metaBlock.body));
  const parts = blocks.flatMap((b) => (b.tag === "part" ? [{ id: b.id, code: b.body }] : []));
  return { text, meta, parts };
}
