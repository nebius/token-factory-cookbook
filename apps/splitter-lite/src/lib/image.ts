// Browser-side image processing. Photos are resized before upload so they stay well under Vercel's
// 4.5 MB body limit and cost fewer vision tokens.

type Variant = { maxEdge: number; targetBytes: number; qualities: number[] };

/** Sent to the vision model: sharp enough to read small print. */
export const FOR_MODEL: Variant = { maxEdge: 1600, targetBytes: 1.2 * 1024 * 1024, qualities: [0.85, 0.75, 0.6, 0.45] };
/** Stored with the expense (~150 KB) so members can check the original bill. */
export const FOR_STORAGE: Variant = { maxEdge: 1100, targetBytes: 160 * 1024, qualities: [0.72, 0.6, 0.5, 0.4, 0.32] };
/** Small preview in lists. */
export const FOR_THUMB: Variant = { maxEdge: 192, targetBytes: 40 * 1024, qualities: [0.7, 0.55, 0.4] };

/** Profile photos: shown at most ~112px, so 512px covers 3x screens. */
export const FOR_AVATAR: Variant = { maxEdge: 512, targetBytes: 90 * 1024, qualities: [0.82, 0.7, 0.55, 0.4] };
export const MAX_RAW_BYTES = 20 * 1024 * 1024;

const isHeic = (source: Blob) =>
  /image\/hei[cf]/i.test(source.type) || ("name" in source && /\.(heic|heif)$/i.test(String((source as File).name)));

async function toBitmap(source: Blob): Promise<ImageBitmap> {
  if (isHeic(source)) {
    throw new Error("HEIC photos aren't supported yet. Use JPEG, or on iPhone set Camera › Formats › Most Compatible.");
  }
  if (!source.type.startsWith("image/")) throw new Error("That's not an image. Use a photo, screenshot or PDF.");
  if (source.size > MAX_RAW_BYTES) throw new Error("That file is over 20 MB. Try a smaller photo or screenshot.");
  return createImageBitmap(source).catch(() => {
    throw new Error("This image couldn't be opened. Try a JPEG or PNG.");
  });
}

function draw(bitmap: ImageBitmap, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process the image");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function encode(canvas: HTMLCanvasElement, v: Variant): Promise<Blob> {
  let last: Blob | null = null;
  for (const q of v.qualities) {
    last = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
    if (last && last.size <= v.targetBytes) return last;
  }
  if (!last) throw new Error("Could not compress the image");
  return last;
}

export async function compressImage(file: Blob, variant: Variant = FOR_MODEL): Promise<Blob> {
  const bitmap = await toBitmap(file);
  try {
    return await encode(draw(bitmap, variant.maxEdge), variant);
  } finally {
    bitmap.close();
  }
}

/** All three versions from one decode: for the model, for storage and a thumbnail. */
export async function prepareBillImage(file: Blob) {
  const bitmap = await toBitmap(file);
  try {
    const [model, stored, thumb] = await Promise.all([
      encode(draw(bitmap, FOR_MODEL.maxEdge), FOR_MODEL),
      encode(draw(bitmap, FOR_STORAGE.maxEdge), FOR_STORAGE),
      encode(draw(bitmap, FOR_THUMB.maxEdge), FOR_THUMB),
    ]);
    return { model, stored, thumb };
  } finally {
    bitmap.close();
  }
}

/**
 * SHA-256 of the original file. Flags the exact same file uploaded twice; look-alike photos of the
 * same bill are left to the AI planner, which compares merchant, date and total.
 */
export async function fileHash(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
