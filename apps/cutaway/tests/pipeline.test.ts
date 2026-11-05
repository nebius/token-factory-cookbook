import { beforeEach, describe, expect, it, vi } from "vitest";

const chat = vi.fn();
vi.mock("@/lib/kimi/client", async (orig) => ({ ...(await orig<typeof import("@/lib/kimi/client")>()), kimiChat: (...a: unknown[]) => chat(...a) }));

import { openDb, useDb } from "@/lib/db/index";
import { createTeardown, getBySlug, getDiagrams, getParts, getTeardown, setIdentityCache } from "@/lib/db/teardowns";
import { design, diagrams, finalize, identify, review, type DesignEvent } from "@/lib/kimi/pipeline";
import { deskFan, readFixture } from "./fixture";

/** Replays stored text through onDelta in small chunks, like a real stream. */
function replay(text: string) {
  return async (o: { onDelta?: (d: { text: string; reasoningChars: number }) => void }) => {
    for (let i = 0; i < text.length; i += 211) o.onDelta?.({ text: text.slice(i, i + 211), reasoningChars: 0 });
    return { text, finishReason: "stop", latencyMs: 1 };
  };
}

describe("pipeline (Kimi mocked)", () => {
  beforeEach(() => {
    useDb(openDb(":memory:"));
    chat.mockReset();
  });

  it("text input skips the identify call", async () => {
    const id = createTeardown({ slug: "draft-a", inputKind: "text", inputHash: "text:fan", text: "desk fan" });
    const r = await identify(id);
    expect(chat).not.toHaveBeenCalled();
    expect(r.identity.device).toBe("desk fan");
    expect(getTeardown(id)!.status).toBe("identified");
  });

  it("a photo seen before is identified from the cache, with no model call", async () => {
    setIdentityCache("img-hash", { device: "outrunner brushless motor", category: "motors-power", confidence: 0.9, visibleClues: [], question: null });
    const id = createTeardown({ slug: "draft-b", inputKind: "image", inputHash: "img-hash", image: Buffer.from("x"), mime: "image/png" });
    const r = await identify(id);
    expect(chat).not.toHaveBeenCalled();
    expect(r.cached).toBe(true);
    expect(r.identity.category).toBe("motors-power");
  });

  it("a new photo calls identify once and caches it", async () => {
    chat.mockResolvedValueOnce({ text: '```json\n{"device":"desk fan","category":"home-appliances","confidence":0.8,"visibleClues":["wire guard"],"question":null}\n```', finishReason: "stop", latencyMs: 1 });
    const id = createTeardown({ slug: "draft-c", inputKind: "image", inputHash: "new-hash", image: Buffer.from("x"), mime: "image/png" });
    await identify(id);
    const id2 = createTeardown({ slug: "draft-d", inputKind: "image", inputHash: "new-hash", image: Buffer.from("x"), mime: "image/png" });
    await identify(id2);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("replays a stored design answer: streams parts, saves meta and code, settles the slug", async () => {
    const { meta, parts } = deskFan();
    chat.mockImplementationOnce(replay(readFixture("desk-fan.design.txt")));
    const id = createTeardown({ slug: "draft-e", inputKind: "text", inputHash: "text:fan", text: "desk fan" });
    await identify(id);
    const events: DesignEvent[] = [];
    await design(id, (e) => events.push(e));
    expect(events.filter((e) => e.type === "part")).toHaveLength(30);
    expect(events.findIndex((e) => e.type === "meta")).toBeLessThan(events.findIndex((e) => e.type === "part"));
    const done = events.find((e) => e.type === "done");
    expect(done).toMatchObject({ slug: "oscillating-desk-fan", partCount: 30 });
    if (done?.type === "done") expect(done.issues.filter((i) => i.severity === "error")).toEqual([]);
    const t = getTeardown(id)!;
    expect(t).toMatchObject({ status: "designed", slug: "oscillating-desk-fan", version: 1, part_count: 30 });
    expect(t.meta).toEqual(meta);
    expect(getParts(id)).toHaveLength(parts.length);
  });

  it("repairs invalid metadata with one extra call", async () => {
    const { meta } = deskFan();
    const broken = structuredClone(meta) as unknown as { device: { sizeMm: unknown } };
    broken.device.sizeMm = "about a foot";
    chat.mockImplementationOnce(replay(`<meta>${JSON.stringify(broken)}</meta><part id="shaft">return kit.mesh(kit.box(1,1,1));</part>`));
    chat.mockResolvedValueOnce({ text: `<meta>${JSON.stringify(meta)}</meta>`, finishReason: "stop", latencyMs: 1 });
    const id = createTeardown({ slug: "draft-f", inputKind: "text", inputHash: "t", text: "fan" });
    await identify(id);
    const events: DesignEvent[] = [];
    await design(id, (e) => events.push(e));
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1][0].kind).toBe("repair");
    expect(events.some((e) => e.type === "repair")).toBe(true);
    const done = events.find((e) => e.type === "done");
    // Only "shaft" has a builder, so the rest are reported for the review round to fill in.
    if (done?.type === "done") expect(done.issues.filter((i) => i.message.startsWith("no <part>")).length).toBe(29);
  });

  it("saves diagrams, applies review fixes and finalizes", async () => {
    chat.mockImplementationOnce(replay(readFixture("desk-fan.design.txt")));
    const id = createTeardown({ slug: "draft-g", inputKind: "text", inputHash: "t2", text: "fan" });
    await identify(id);
    await design(id, () => {});

    chat.mockResolvedValueOnce({ text: readFixture("desk-fan.diagrams.txt"), finishReason: "stop", latencyMs: 1 });
    const d = await diagrams(id);
    expect(d.diagrams.map((x) => x.kind).sort()).toEqual(["callouts", "flow", "section"]);
    expect(getDiagrams(id)).toHaveLength(3);

    chat.mockResolvedValueOnce({
      text: '<part id="shaft">return kit.at(kit.mesh(kit.cyl(4,4,200,24), kit.mat("steel")), [0,70,-33], [90,0,0]);</part><part id="ghost">x</part><patch>[{"id":"rotor","explode":{"direction":[0,0,-1],"distance":90,"order":11}}]</patch><verdict>longer shaft</verdict>',
      finishReason: "stop",
      latencyMs: 1,
    });
    const img = "data:image/jpeg;base64,AAAA";
    const r = await review(id, { images: { front: img, iso: img, exploded: img, cutaway: img }, issues: [], round: 1 });
    expect(r.fixes.map((f) => f.id)).toEqual(["shaft"]);
    expect(r.patched).toEqual(["rotor"]);
    expect(r.verdict).toBe("longer shaft");
    expect(getParts(id).find((p) => p.part_id === "shaft")).toMatchObject({ revision: 1 });
    expect(getTeardown(id)!.meta!.parts.find((p) => p.id === "rotor")!.explode.distance).toBe(90);
    expect(chat.mock.calls[2][0].messages[1].content.filter((c: { type: string }) => c.type === "image_url")).toHaveLength(4);

    finalize(id, { results: [{ id: "shaft", ok: true }], thumbnail: img });
    expect(getBySlug("oscillating-desk-fan")!.id).toBe(id);
  });
});
