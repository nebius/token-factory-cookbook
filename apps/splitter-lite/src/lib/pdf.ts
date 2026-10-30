// Renders PDF invoice pages to images in the browser so the vision model can read them.
// pdf.js (~1 MB) is loaded only when someone actually picks a PDF.

export const MAX_PDF_PAGES = 4;

let workerReady: Promise<typeof import("pdfjs-dist")> | undefined;

function loadPdfJs() {
  workerReady ??= import("pdfjs-dist").then((pdfjs) => {
    try {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), {
        type: "module",
      });
    } catch (e) {
      // Some browsers/bundlers can't start a module worker; pdf.js then runs on the main thread.
      console.warn("pdf.js worker unavailable, using main thread", e);
    }
    return pdfjs;
  });
  workerReady.catch(() => (workerReady = undefined));
  return workerReady;
}

export const isPdf = (file: File) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

/** Returns one PNG blob per page (first MAX_PDF_PAGES pages), rendered at roughly 1600px wide. */
export async function pdfToImages(file: File): Promise<{ pages: Blob[]; totalPages: number }> {
  if (file.size > 20 * 1024 * 1024) throw new Error("That PDF is over 20 MB.");
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (e) {
    await loadingTask.destroy();
    console.error("PDF could not be opened", e);
    throw new Error(e instanceof Error && /password/i.test(e.message) ? "That PDF is password-protected." : "That PDF couldn't be opened. Try exporting it again or take a screenshot.");
  }
  try {
    const pages: Blob[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, 1600 / base.width) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      pages.push(await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Render failed"))), "image/png")));
      page.cleanup();
    }
    return { pages, totalPages: doc.numPages };
  } finally {
    await loadingTask.destroy();
  }
}
