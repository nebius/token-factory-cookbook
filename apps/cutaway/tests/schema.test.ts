import { describe, expect, it } from "vitest";
import { checkMeta, checkSvg } from "@/lib/check/meta";
import { metaJsonSchema, MetaSchema } from "@/lib/schema/teardown";
import { deskFan } from "./fixture";

describe("schema and meta checks", () => {
  it("accepts the desk fan fixture with no errors", () => {
    const { meta, parts } = deskFan();
    expect(meta.parts).toHaveLength(30);
    const issues = checkMeta(meta, parts.map((p) => p.id));
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("round-trips through JSON", () => {
    const { meta } = deskFan();
    expect(MetaSchema.parse(JSON.parse(JSON.stringify(meta)))).toEqual(meta);
  });

  it("produces a JSON schema for the prompt", () => {
    const s = JSON.parse(metaJsonSchema());
    expect(s.properties.parts.items.properties.explode).toBeDefined();
  });

  it("catches seeded reference errors", () => {
    const { meta, parts } = deskFan();
    const bad = structuredClone(meta);
    bad.parts[1].parentId = "ghost";
    bad.parts[2].explode.direction = [0, 0, 0];
    bad.systems[0].path.push("nowhere");
    bad.steps[0].focusPartIds.push("missing-part");
    bad.study.quiz[0].answer = 9;
    bad.parts.push({ ...bad.parts[0] });
    const ids = parts.map((p) => p.id).filter((id) => id !== "shaft");
    const msgs = checkMeta(bad, ids).filter((i) => i.severity === "error").map((i) => i.message);
    expect(msgs).toEqual(
      expect.arrayContaining([
        'parent "ghost" does not exist',
        "explode direction is [0,0,0]",
        'system "Electrical power path" references unknown part "nowhere"',
        'step 1 references unknown part "missing-part"',
        "quiz question 1 answer index 9 is out of range",
        'duplicate part id "guard-rim-clip"',
        "no <part> builder was written for this part",
      ]),
    );
  });

  it("checks diagram SVG structure", () => {
    expect(checkSvg('<svg viewBox="0 0 10 10"></svg>')).toBeNull();
    expect(checkSvg("<div/>")).toMatch(/start with <svg/);
    expect(checkSvg("<svg></svg>")).toMatch(/viewBox/);
  });
});

describe("forgiving enums", () => {
  it("keeps an answer with a small enum slip instead of rejecting it", () => {
    const { meta } = deskFan();
    const raw = JSON.parse(JSON.stringify(meta));
    raw.steps[1].view = "rear-iso";
    raw.parts[0].confidence = "very high";
    raw.systems[0].kind = "electricity";
    raw.device.category = "kitchen";
    const r = MetaSchema.parse(raw);
    expect([r.steps[1].view, r.parts[0].confidence, r.systems[0].kind, r.device.category]).toEqual(["iso", "medium", "force", "other"]);
  });
});
