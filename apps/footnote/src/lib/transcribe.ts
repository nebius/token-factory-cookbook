import { jsonrepair } from "jsonrepair";
import sharp from "sharp";
import { z } from "zod";
import { ask, imagePart, type CallLog, type Reply, type Tool } from "@/lib/model/client";
import { pageImage, viewImage } from "@/lib/pages";
import type { Box, PageText, TextRun } from "@/lib/pdf";
import type { DocKey } from "@/lib/runs";

// Scanned pages have no usable text layer, so before the agent starts, the model reads each one from
// its image: one call per page, lines of text with a box each. The result becomes that page's text
// layer, marked origin "model", and every check against it says it is checking the model's reading,
// not the PDF's text.

const TRANSCRIBE_SYSTEM = `You transcribe scanned pages of reports so that every number on them can be checked later.

Return every line of printed text on the page, top to bottom, exactly as printed:
- Keep every digit, decimal point, minus sign, parenthesis, percent sign, comma and footnote mark. Do not correct, round, reformat or complete numbers, and do not add anything that is not printed.
- For a table, give one line per row: the row label, then each cell value in order, separated by two spaces. Give the column headings as their own lines first.
- For a chart, transcribe its title, axis labels, legend and any values printed on it. Do not estimate plotted values.
- Where a character cannot be read, write ? in its place.
- Give each line its box [x, y, width, height] as fractions of the page (0 to 1, top-left origin).
- Set figure to true when the page has a chart or diagram.

Call submit_page_text once with the whole page.`;

const transcribeTool: Tool = {
  type: "function",
  function: {
    name: "submit_page_text",
    description: "Submit the transcription of the page: every printed line in reading order, with its box.",
    parameters: {
      type: "object",
      properties: {
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4, description: "[x, y, width, height] as fractions of the page, top-left origin" },
            },
            required: ["text"],
          },
        },
        figure: { type: "boolean", description: "true when the page has a chart or diagram" },
      },
      required: ["lines"],
    },
  },
};

const Line = z.object({ text: z.coerce.string(), box: z.array(z.coerce.number()).length(4).optional().nullable().catch(null) });
const PageOut = z.object({ lines: z.array(Line).max(600), figure: z.boolean().optional().catch(false) });
export type Transcription = z.infer<typeof PageOut>;

// The tool call when there is one, else JSON in the reply text.
export function parseTranscription(reply: Pick<Reply, "text" | "toolCalls">): Transcription | null {
  const raw = reply.toolCalls.find((c) => c.name === "submit_page_text")?.arguments ?? reply.text.match(/\{[\s\S]*\}/)?.[0];
  if (!raw) return null;
  for (const attempt of [() => JSON.parse(raw), () => JSON.parse(jsonrepair(raw))]) {
    try {
      const r = PageOut.safeParse(attempt());
      if (r.success) return r.data;
    } catch {}
  }
  return null;
}

// Boxes should be fractions of the page; some replies use percent or the pixels of the image sent.
export function clampBox(b: number[] | null | undefined, img: { width: number; height: number } = { width: 1, height: 1 }): Box | null {
  if (!b || b.length !== 4 || !b.every((v) => Number.isFinite(v))) return null;
  const big = Math.max(...b.map((v) => Math.abs(v)));
  const sx = big <= 1.5 ? 1 : big <= 100 ? 100 : img.width;
  const sy = big <= 1.5 ? 1 : big <= 100 ? 100 : img.height;
  const [x, y, w, h] = [b[0] / sx, b[1] / sy, b[2] / sx, b[3] / sy];
  const cx = Math.min(1, Math.max(0, x));
  const cy = Math.min(1, Math.max(0, y));
  const cw = Math.min(1 - cx, Math.max(0.005, w));
  const ch = Math.min(1 - cy, Math.max(0.004, h));
  return [cx, cy, cw, ch];
}

// The model's lines as a text layer. Lines without a usable box get an evenly spaced one, so the page
// can still be highlighted roughly.
export function toPageText(base: PageText, t: Transcription, img?: { width: number; height: number }): PageText {
  const lines = t.lines.map((l) => ({ s: l.text.replace(/\s+/g, " ").trim(), box: l.box })).filter((l) => l.s);
  const runs: TextRun[] = lines.map((l, i) => ({ s: l.s, box: clampBox(l.box, img) ?? [0.06, 0.04 + (0.92 * i) / Math.max(1, lines.length), 0.88, 0.85 / Math.max(1, lines.length)] }));
  return {
    ...base,
    text: runs.map((r) => r.s).join(" "),
    runs,
    figures: !!t.figure,
    origin: "model",
    fileText: base.kind === "ocr" ? base.text : undefined,
  };
}

export function needsTranscription(p: PageText) {
  return p.kind === "scanned" || p.kind === "ocr";
}

type Opts = {
  runId: string;
  doc: DocKey;
  docName: string;
  hash: string;
  pages: PageText[];
  onCall: (log: CallLog) => void;
  onPage: (done: number, total: number, page: number) => Promise<void> | void;
  concurrency?: number;
};

// Transcribes every page that needs it, a few at a time. Returns the pages with transcribed text
// layers swapped in, and the page numbers that were read by the model.
export async function transcribe(o: Opts): Promise<{ pages: PageText[]; read: number[]; failed: number[] }> {
  const todo = o.pages.filter(needsTranscription);
  const out = [...o.pages];
  const read: number[] = [];
  const failed: number[] = [];
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const p = todo[next++];
      try {
        const png = await pageImage(o.runId, p.n, o.doc);
        // A render with almost no ink means the image could not be decoded (or the page is blank):
        // don't ask the model to read nothing.
        const ink = await sharp(png).greyscale().stats();
        if (ink.channels[0].mean > 254.5) {
          failed.push(p.n);
          await o.onPage(++done, todo.length, p.n);
          continue;
        }
        const jpg = await viewImage(png, null);
        const meta = await sharp(jpg).metadata();
        const { reply, log } = await ask({
          step: 0,
          replayKey: `transcribe-${o.hash}-p${p.n}`,
          maxTokens: 32_000,
          tools: [transcribeTool],
          messages: [
            { role: "system", content: TRANSCRIBE_SYSTEM },
            { role: "user", content: [{ type: "text", text: `Page ${p.n} of ${o.pages.length} of “${o.docName}”. Transcribe it.` }, imagePart(`data:image/jpeg;base64,${jpg.toString("base64")}`)] },
          ],
        });
        const t = parseTranscription(reply);
        o.onCall({ ...log, stage: "transcribe", page: p.n, doc: o.doc, ...(t ? {} : { error: reply.finishReason === "length" ? "Reply cut off at the output limit" : "No transcription in the reply" }) });
        if (t && t.lines.length) {
          out[p.n - 1] = toPageText(p, t, { width: meta.width ?? 1400, height: meta.height ?? 1800 });
          read.push(p.n);
        } else failed.push(p.n);
      } catch (e) {
        const log = (e as { log?: CallLog }).log;
        if (log) o.onCall({ ...log, stage: "transcribe", page: p.n, doc: o.doc });
        failed.push(p.n);
      }
      await o.onPage(++done, todo.length, p.n);
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency ?? 4, todo.length) }, worker));
  return { pages: out, read: read.sort((a, b) => a - b), failed: failed.sort((a, b) => a - b) };
}
