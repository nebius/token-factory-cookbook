import { afterEach, describe, expect, it, vi } from "vitest";
import { addUsage, costOf, emptyUsage, modelInfo } from "./pricing";

describe("pricing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads per-token prices from the catalog and prices usage, reasoning included", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            { id: "other", pricing: { prompt: "1", completion: "1" } },
            {
              id: "nvidia/Nemotron-3.5-Super-VL",
              pricing: { prompt: "0.0000003", completion: "0.0000009" },
              supported_features: ["tools", "reasoning"],
              architecture: { modality: "text+image->text" },
              context_length: 1048576,
            },
          ],
        }),
      ),
    );
    const info = await modelInfo({ apiKey: "k", baseURL: "https://example.test/v1/", model: "nvidia/Nemotron-3.5-Super-VL" });
    expect(info).toMatchObject({ inputPerM: 0.3, outputPerM: 0.9, features: ["tools", "reasoning"], modality: "text+image->text" });
    expect(info!.source).toBe("https://example.test/v1/models?verbose=true");

    const u = emptyUsage();
    addUsage(u, { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, completion_tokens_details: { reasoning_tokens: 400 } });
    addUsage(u, { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 });
    expect(u).toEqual({ input: 2000, output: 1000, reasoning: 400, calls: 2 });
    expect(costOf(u, info)).toBeCloseTo((2000 * 0.3 + 1000 * 0.9) / 1e6, 12);
    expect(costOf(u, null)).toBeNull();
  });
});
