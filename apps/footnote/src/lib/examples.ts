import fs from "node:fs/promises";
import path from "node:path";
import type { Source } from "@/lib/runs";

// Bundled real documents, cut to a few pages so a run stays short. See fixtures/filings/ATTRIBUTION.md.
// An example with `b` is a comparison of two documents; `kind` says what it shows off.

export type ExampleDoc = { file: string; name: string; publisher: string; pages: string; url: string; licence: string };

export type Example = ExampleDoc & {
  id: string;
  kind?: "single" | "scanned" | "compare";
  focus?: string;
  b?: ExampleDoc;
};

const DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "fixtures", "filings");

export async function listExamples(): Promise<Example[]> {
  return JSON.parse(await fs.readFile(path.join(DIR, "index.json"), "utf8")) as Example[];
}

export async function exampleFile(file: string): Promise<Buffer> {
  if (!/^[a-z0-9-]+\.pdf$/.test(file)) throw new Error("bad example name");
  return fs.readFile(path.join(DIR, file));
}

export function exampleSource(d: ExampleDoc): Source {
  return { name: d.name, url: d.url, licence: d.licence, author: d.publisher, note: d.pages };
}
