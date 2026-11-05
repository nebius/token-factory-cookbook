import { describe, expect, it } from "vitest";
import { extractJson, parseTagged, stripFence, TaggedStreamParser } from "@/lib/kimi/parse";
import { readFixture } from "./fixture";

describe("tagged format", () => {
  it("reads meta, parts, diagrams, patch and verdict blocks", () => {
    const text = `intro <meta>{"a":1}</meta>
<part id="hub">return kit.mesh(kit.box(1,1,1));</part>
<part id='rim'>
\`\`\`js
return x;
\`\`\`
</part>
<diagram kind="section" title="Cut A-A"><svg viewBox="0 0 1 1"><metadata>m</metadata><path d=""/></svg></diagram>
<patch>[{"id":"hub"}]</patch><verdict>looks right</verdict>`;
    const b = parseTagged(text);
    expect(b.map((x) => x.tag)).toEqual(["meta", "part", "part", "diagram", "patch", "verdict"]);
    expect(b[2]).toEqual({ tag: "part", id: "rim", body: "return x;" });
    expect(b[3]).toMatchObject({ kind: "section", title: "Cut A-A" });
  });

  it("emits blocks as soon as they close, across any chunk boundaries", () => {
    const text = readFixture("desk-fan.design.txt");
    const whole = parseTagged(text);
    const p = new TaggedStreamParser();
    const streamed = [];
    for (let i = 0; i < text.length; i += 37) streamed.push(...p.push(text.slice(i, i + 37)));
    expect(streamed).toEqual(whole);
    expect(whole.filter((b) => b.tag === "part").length).toBe(30);
  });

  it("extracts JSON from prose, fences and trailing commas", () => {
    expect(extractJson('Sure! ```json\n{"a": [1, 2,],}\n```')).toEqual({ a: [1, 2] });
    expect(extractJson('here: {"device":"fan"} hope that helps')).toEqual({ device: "fan" });
    expect(stripFence("```\nx\n```")).toBe("x");
  });
});
