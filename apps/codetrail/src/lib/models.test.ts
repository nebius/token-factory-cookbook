import { describe, expect, it } from "vitest";
import { modelLabel, modelsOf, withModels } from "./models";

describe("model names", () => {
  it("names the two models Codetrail runs on, and falls back to the id for others", () => {
    expect(modelLabel("deepseek-ai/DeepSeek-V4.1-Flash-1017")).toBe("DeepSeek V4.1 Flash 1017");
    expect(modelLabel("moonshotai/Kimi-K3.1-Pro")).toBe("Kimi K3.1 Pro");
    expect(modelLabel("acme/Some-Model-2")).toBe("Some Model 2");
    expect(modelLabel(undefined)).toBe("DeepSeek V4.1 Flash 1017");
  });

  it("credits every model behind a set of calls once, and none when a person wrote it", () => {
    const calls = [{ model: "deepseek-ai/DeepSeek-V4.1-Flash-1017" }, { model: "moonshotai/Kimi-K3.1-Pro" }, { model: "moonshotai/Kimi-K3.1-Pro" }];
    expect(modelsOf(calls)).toEqual(["DeepSeek V4.1 Flash 1017", "Kimi K3.1 Pro"]);
    expect(withModels(calls)).toBe(" with DeepSeek V4.1 Flash 1017 and Kimi K3.1 Pro");
    expect(withModels([])).toBe("");
  });
});
