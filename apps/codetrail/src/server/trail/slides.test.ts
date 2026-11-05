import { describe, expect, it } from "vitest";
import { sentences, slidesHtml } from "./slides";

describe("slides", () => {
  it("splits sentences, but not at a full stop inside code", () => {
    expect(sentences("Wraps `http.Server` and calls `.listen()`. Then it routes. More here. And more.", 3)).toEqual(["Wraps `http.Server` and calls `.listen()`.", "Then it routes.", "More here."]);
    expect(sentences("No full stop at the end", 2)).toEqual(["No full stop at the end"]);
  });

  it("writes a standalone page, escaped, the first slide shown", () => {
    const html = slidesHtml([{ kind: "title", kicker: "k", title: "<script>x</script>", bullets: ["uses `a.b`"] }, { kind: "end", kicker: "k", title: "End" }], "T");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("<li>uses <code>a.b</code></li>");
    expect(html.match(/<section[^>]*hidden/g)).toHaveLength(1);
  });
});
