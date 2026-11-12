import { afterEach, describe, expect, it, vi } from "vitest";

const pdf = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerPort: undefined as unknown },
}));
vi.mock("pdfjs-dist", () => pdf);
import { pdfToImages } from "./pdf";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("PDF.js loading task cleanup", () => {
  it("releases the loading task after rendering a page", async () => {
    vi.stubGlobal("Worker", class {});
    const destroy = vi.fn().mockResolvedValue(undefined);
    const cleanup = vi.fn();
    const page = {
      getViewport: () => ({ width: 800, height: 1200 }),
      render: () => ({ promise: Promise.resolve() }),
      cleanup,
    };
    pdf.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: async () => page }),
      destroy,
    });
    vi.stubGlobal("document", { createElement: () => ({
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["image"], { type: "image/png" })),
    }) });
    const result = await pdfToImages(new File(["pdf"], "bill.pdf"));
    expect(result.pages).toHaveLength(1);
    expect(result.totalPages).toBe(1);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("releases a failed loading task and reports a readable error", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    pdf.getDocument.mockReturnValue({ promise: Promise.reject(new Error("Invalid PDF")), destroy });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(pdfToImages(new File(["invalid"], "bill.pdf"))).rejects.toThrow("couldn't be opened");
    expect(destroy).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
