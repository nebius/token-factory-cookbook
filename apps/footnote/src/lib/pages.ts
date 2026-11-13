import sharp from "sharp";
import { renderPage } from "@/lib/pdf";
import { docFile, hasRunFile, readRunFile, writeRunFile, type DocKey } from "@/lib/runs";

// Page images, rendered once per run and cached next to the PDF.

const WIDTH = 1400;

// One render at a time per page, so the UI and the agent asking together don't render twice.
const pending = new Map<string, Promise<Buffer>>();

export async function pageImage(runId: string, n: number, doc: DocKey = "A"): Promise<Buffer> {
  const name = docFile(doc, `page-${n}.png`);
  if (await hasRunFile(runId, name)) return readRunFile(runId, name);
  const k = `${runId}/${doc}/${n}`;
  if (!pending.has(k)) {
    pending.set(
      k,
      (async () => {
        const pdf = await readRunFile(runId, docFile(doc, "document.pdf"));
        const png = await renderPage(new Uint8Array(pdf), n, WIDTH);
        await writeRunFile(runId, name, png);
        return png;
      })().finally(() => pending.delete(k)),
    );
  }
  return pending.get(k)!;
}

type Crop = [x: number, y: number, w: number, h: number];

export function validCrop(c: unknown): Crop | null {
  if (!Array.isArray(c) || c.length !== 4 || !c.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const [x, y] = c.map((v) => Math.min(1, Math.max(0, v)));
  const w = Math.min(c[2] as number, 1 - x);
  const h = Math.min(c[3] as number, 1 - y);
  if (w < 0.02 || h < 0.02) return null;
  return [x, y, w, h];
}

// JPEG for the model: the full page, or a crop enlarged so small chart labels stay legible.
export async function viewImage(png: Buffer, crop: Crop | null): Promise<Buffer> {
  let img = sharp(png);
  if (crop) {
    const meta = await sharp(png).metadata();
    const W = meta.width ?? WIDTH;
    const H = meta.height ?? WIDTH;
    const left = Math.round(crop[0] * W);
    const top = Math.round(crop[1] * H);
    const width = Math.max(8, Math.min(W - left, Math.round(crop[2] * W)));
    const height = Math.max(8, Math.min(H - top, Math.round(crop[3] * H)));
    img = img.extract({ left, top, width, height }).resize({ width: Math.min(1400, width * 2), withoutEnlargement: false });
  }
  return img.flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
}
