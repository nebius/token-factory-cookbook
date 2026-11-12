import { describe, expect, it } from "vitest";
import { richBlocks } from "./rich";

describe("richBlocks", () => {
  it("splits prose, fenced code and >> commands, in order", () => {
    const text = "Install it first:\n>> npm install polka\nThen:\n```js\nconst app = polka();\napp.listen(3000);\n```\nThat's all.";
    expect(richBlocks(text)).toEqual([
      { kind: "text", text: "Install it first:" },
      { kind: "command", text: "npm install polka" },
      { kind: "text", text: "Then:" },
      { kind: "code", text: "const app = polka();\napp.listen(3000);" },
      { kind: "text", text: "That's all." },
    ]);
  });

  it("leaves plain text alone, including a >> in the middle of a line", () => {
    expect(richBlocks("a >> b, then `x`")).toEqual([{ kind: "text", text: "a >> b, then `x`" }]);
  });
});
