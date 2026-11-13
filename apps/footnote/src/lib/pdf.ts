import { createCanvas } from "@napi-rs/canvas";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

// Everything Footnote knows about a PDF comes from here: the text layer of each page (with a box for
// every text run, so a cited number can be highlighted) and page images for the model to look at.

export type Box = [x: number, y: number, w: number, h: number]; // fractions of the page, top-left origin

export type TextRun = { s: string; box: Box };

export type PageText = {
  n: number; // 1-based
  width: number; // points
  height: number;
  text: string; // runs joined with single spaces (offsets line up with runs)
  runs: TextRun[];
  // Pictures or lots of vector drawing: numbers there may only be readable from the image.
  figures: boolean;
  // "text": a born-digital page. "scanned": an image with no usable text. "ocr": a full-page image under
  // an invisible text layer someone else's OCR produced. Footnote has the model transcribe the last two.
  kind?: PageKind;
  // Where `text` came from: the PDF itself, or the model reading the page image ("read by the model").
  origin?: "pdf" | "model";
  // For "ocr" pages, the file's own hidden OCR text, kept for cross-checking the model's transcription.
  fileText?: string;
};

export type PageKind = "text" | "scanned" | "ocr";

// pdf.js decodes JBIG2, CCITT fax and JPEG 2000 images (what most scans are made of) with WebAssembly
// modules, and draws non-embedded fonts from its standard font files. In Node it must be told where both
// live, or scanned pages render blank.
// The app's own node_modules first: inside a Next.js server bundle, require.resolve returns a virtual
// "[externals]" path that pdf.js cannot read from.
function pdfjsDir() {
  const local = path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", "pdfjs-dist");
  if (fs.existsSync(path.join(local, "wasm"))) return local;
  try {
    return path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  } catch {
    return local;
  }
}
const PDFJS = pdfjsDir();
const ASSETS = { wasmUrl: path.join(PDFJS, "wasm") + path.sep, standardFontDataUrl: path.join(PDFJS, "standard_fonts") + path.sep };

async function open(data: Uint8Array) {
  // Copy: pdf.js takes ownership of the buffer it is given.
  const task = pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: false, verbosity: 0, ...ASSETS });
  const doc = await task.promise;
  return { doc, close: () => task.destroy() };
}

export async function readText(data: Uint8Array, maxPages = 300): Promise<PageText[]> {
  const { doc, close } = await open(data);
  try {
    if (doc.numPages > maxPages) throw new Error(`This PDF has ${doc.numPages} pages; the limit is ${maxPages}.`);
    const pages: PageText[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const runs: TextRun[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const t = pdfjs.Util.transform(vp.transform, item.transform);
        const fontHeight = Math.hypot(t[2], t[3]) || 1;
        const x = t[4];
        const y = t[5] - fontHeight;
        runs.push({ s: item.str.replace(/\s+/g, " ").trim(), box: [x / vp.width, y / vp.height, (item.width * vp.scale) / vp.width, (fontHeight * 1.15) / vp.height] });
      }
      const ops = await page.getOperatorList();
      const text = runs.map((r) => r.s).join(" ");
      const view = page.view;
      const kind = pageKind(ops, text, Math.abs((view[2] - view[0]) * (view[3] - view[1])));
      pages.push({ n, width: vp.width, height: vp.height, text, runs, figures: kind === "text" ? hasFigure(ops, text) : true, kind, origin: "pdf" });
      page.cleanup();
    }
    return pages;
  } finally {
    await close();
  }
}

// A chart or picture worth reading from the image: a raster image of real size (logos and icons are
// small), or a figure caption (vector charts draw as a handful of paths, the same as a ruled table,
// so path counts say nothing).
const CAPTION = /\b(?:Figure|Chart|Exhibit|Graph) \d+(?:\.[A-Z])?\. \S/;

export function hasFigure(ops: { fnArray: number[]; argsArray: unknown[] }, text: string) {
  const O = pdfjs.OPS;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn !== O.paintImageXObject && fn !== O.paintInlineImageXObject) continue;
    const a = ops.argsArray[i] as unknown[] | undefined;
    const img = (fn === O.paintInlineImageXObject ? a?.[0] : null) as { width?: number; height?: number } | null;
    const w = Number(img?.width ?? a?.[1] ?? 0);
    const h = Number(img?.height ?? a?.[2] ?? 0);
    if (Math.min(w, h) >= 150 && w * h >= 150_000) return true;
  }
  return CAPTION.test(text);
}

// The title in the PDF's own metadata, when it has a usable one.
// How much of the page its largest image covers, and whether any text is drawn invisibly (text render
// mode 3 or 7, which is how OCR software lays recognised text under a scan).
export function imageCover(ops: { fnArray: number[]; argsArray: unknown[] }, pageArea: number) {
  const O = pdfjs.OPS;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  let cover = 0;
  let invisible = false;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const a = ops.argsArray[i] as unknown[] | undefined;
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === O.transform && a && a.length >= 6) ctm = pdfjs.Util.transform(ctm, a as number[]);
    else if (fn === O.setTextRenderingMode && (a?.[0] === 3 || a?.[0] === 7)) invisible = true;
    else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintImageMaskXObject) {
      // Images are drawn on the unit square, so the CTM's determinant is the area they cover.
      const area = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
      if (pageArea > 0) cover = Math.max(cover, Math.min(1, area / pageArea));
    }
  }
  return { cover, invisible };
}

export function pageKind(ops: { fnArray: number[]; argsArray: unknown[] }, text: string, pageArea: number): PageKind {
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const { cover, invisible } = imageCover(ops, pageArea);
  if (letters < 40 && cover >= 0.3) return "scanned";
  if (cover >= 0.8 && invisible) return "ocr";
  return "text";
}

export async function docTitle(data: Uint8Array): Promise<string | null> {
  const { doc, close } = await open(data);
  try {
    const meta = await doc.getMetadata();
    const t = String((meta.info as { Title?: unknown } | undefined)?.Title ?? "").replace(/\s+/g, " ").trim();
    return t.length >= 4 && t.length <= 160 && /[a-z]/i.test(t) && !/^(untitled|microsoft word|document\d*)\b/i.test(t) && !/\.(docx?|pdf|indd)$/i.test(t) ? t : null;
  } catch {
    return null;
  } finally {
    await close();
  }
}

// PNG of one page, `width` pixels wide.
export async function renderPage(data: Uint8Array, n: number, width = 1400): Promise<Buffer> {
  const { doc, close } = await open(data);
  try {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / base.width });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // pdf.js accepts a @napi-rs/canvas context in Node.
    await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport: vp }).promise;
    return canvas.toBuffer("image/png");
  } finally {
    await close();
  }
}
