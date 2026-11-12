import { describe, expect, it } from "vitest";
import { callCost, kimiPrice } from "@/lib/kimi/pricing";
import { kimiConfig } from "@/lib/kimi/client";

describe("Nebius pricing", () => {
  it("bills cached input at the cached rate and the rest at the normal rate", () => {
    const price = { input: 1e-6, cachedInput: 0.1e-6, output: 4e-6, source: "nebius" as const };
    // 1,000 input of which 400 cached, 2,000 output
    expect(callCost(price, { prompt_tokens: 1000, completion_tokens: 2000, cached: 400 })).toBeCloseTo(600e-6 + 40e-6 + 8000e-6, 12);
  });

  it("uses the price from settings when the model list can't be read", async () => {
    const c = kimiConfig({ KIMI_PRICE_INPUT: "2", KIMI_PRICE_OUTPUT: "8", KIMI_BASE_URL: "http://127.0.0.1:9/v1/", NEBIUS_API_KEY: "x" } as unknown as NodeJS.ProcessEnv);
    const p = await kimiPrice(c);
    expect(p).toMatchObject({ input: 2e-6, output: 8e-6, source: "settings" });
  });

  it("has no price in replay mode", async () => {
    expect(await kimiPrice(kimiConfig({ KIMI_PROVIDER: "replay" } as unknown as NodeJS.ProcessEnv))).toBeNull();
  });
});
