import { describe, expect, it } from "vitest";
import { tourUrl } from "./tour-url";

describe("tourUrl", () => {
  it("accepts GitHub files and raw gists, turning blob pages into raw links", () => {
    expect(tourUrl("https://raw.githubusercontent.com/o/r/main/.tours/a.tour")).toBe("https://raw.githubusercontent.com/o/r/main/.tours/a.tour");
    expect(tourUrl("https://github.com/o/r/blob/v2/.tours/intro.tour?plain=1")).toBe("https://raw.githubusercontent.com/o/r/v2/.tours/intro.tour");
    expect(tourUrl("https://gist.githubusercontent.com/u/abc123/raw/x.tour")).toBe("https://gist.githubusercontent.com/u/abc123/raw/x.tour");
  });

  it("refuses everything else: other hosts, http, credentials, ports, pages that aren't files", () => {
    for (const bad of ["http://raw.githubusercontent.com/o/r/main/a.tour", "https://example.com/a.tour", "https://user:pw@raw.githubusercontent.com/o/r/main/a.tour", "https://raw.githubusercontent.com:8443/o/r/main/a.tour", "https://github.com/o/r/tree/main/.tours", "https://gist.github.com/u/abc123", "file:///etc/passwd", "not a url"]) {
      expect(tourUrl(bad), bad).toBeNull();
    }
  });
});
