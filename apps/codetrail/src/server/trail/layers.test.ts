import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Atlas } from "@/lib/schemas";

const calls: { prefix: unknown[]; task: string }[] = [];
const saved: [string, Atlas][] = [];
vi.mock("@/server/ai/nebius", () => ({
  chatJSON: async (_cfg: unknown, opts: { prefix: unknown[]; task: string }) => {
    calls.push(opts);
    return { modules: [{ id: "api", layer: " Entry points " }, { id: "db", layer: "Storage" }] };
  },
}));
vi.mock("@/server/store", () => ({ putJSON: async (key: string, value: Atlas) => void saved.push([key, value]) }));
vi.mock("./service", () => ({
  checkLimitsFor: async () => {},
  commitKey: () => "repos/o/r/sha",
  shared: (_key: string, run: () => unknown) => run(),
  trackedCall: async (_p: unknown, _kind: string, _label: string, run: (cfg: unknown) => unknown) => ({ result: await run({}), record: {} }),
}));
const { addLayers } = await import("./layers");

const atlas = {
  nodes: [
    { id: "api", label: "API", kind: "entry", purpose: "Serves requests.", files: ["src/api.ts"] },
    { id: "db", label: "DB", kind: "data", purpose: "Stores rows.", files: ["src/db.ts"] },
    { id: "misc", label: "Misc", kind: "core", purpose: "Other.", files: ["src/misc.ts"] },
  ],
  edges: [{ from: "api", to: "db", label: "saves", verified: true }],
} as Atlas;
const p = { info: { owner: "o", repo: "r", sha: "sha" } } as Parameters<typeof addLayers>[0];

describe("addLayers", () => {
  beforeEach(() => {
    calls.length = 0;
    saved.length = 0;
  });

  it("sends only the module list, then saves the map with a layer on every module", async () => {
    const next = await addLayers(p, atlas, "anon:1");
    expect(calls).toHaveLength(1);
    expect(calls[0].prefix).toEqual([]);
    expect(calls[0].task).toContain("- api: API, entry. Serves requests. src/api.ts");
    expect(next.nodes.map((n) => n.layer)).toEqual(["Entry points", "Storage", "Other"]);
    expect(saved).toEqual([["repos/o/r/sha/atlas.json", next]]);
  });

  it("is free when the map already has layers", async () => {
    const layered = { ...atlas, nodes: atlas.nodes.map((n) => ({ ...n, layer: "Core" })) };
    expect(await addLayers(p, layered, "anon:1")).toBe(layered);
    expect(calls).toHaveLength(0);
  });
});
