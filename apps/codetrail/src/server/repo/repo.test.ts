import { describe, expect, it } from "vitest";
import { skipReason, looksMinified } from "./filter";
import { buildImportGraph, summarizeGraph } from "./graph";
import { packRepo, priorityOf } from "./pack";
import { parseRepoInput } from "@/lib/ref";

const file = (path: string, text: string) => ({ path, text, lines: text.split("\n").length });

describe("parseRepoInput", () => {
  it.each([
    ["expressjs/express", { owner: "expressjs", repo: "express" }],
    ["https://github.com/honojs/hono", { owner: "honojs", repo: "hono" }],
    ["github.com/pmndrs/zustand.git", { owner: "pmndrs", repo: "zustand" }],
    ["git@github.com:vercel/next.js.git", { owner: "vercel", repo: "next.js" }],
    ["https://github.com/a/b/tree/v2/src/x.ts", { owner: "a", repo: "b", ref: "v2" }],
    ["https://github.com/a/b/blob/main/src/app.ts#L10-L20", { owner: "a", repo: "b", ref: "main", path: "src/app.ts" }],
    ["a/b@main", { owner: "a", repo: "b", ref: "main" }],
    ["https://github.com/a/b?tab=readme#top", { owner: "a", repo: "b" }],
    ["https://github.com/a/b/pull/123", { owner: "a", repo: "b", pull: 123 }],
    ["https://github.com/a/b/pull/42/files#diff-abc", { owner: "a", repo: "b", pull: 42 }],
    ["a/b#7", { owner: "a", repo: "b", pull: 7 }],
    ["https://github.com/a/b/pull/new", { owner: "a", repo: "b" }],
  ])("%s", (input, expected) => expect(parseRepoInput(input)).toEqual(expected));

  it.each(["", "gitlab.com/a/b", "just-a-name", "a/b c"])("rejects %j", (input) => expect(parseRepoInput(input)).toBeNull());
});

describe("skipReason", () => {
  it("keeps source, docs and manifests", () => {
    for (const p of ["src/index.ts", "README.md", "package.json", "go.mod", "Dockerfile", "lib/app.py", "bin/cli.js"]) expect(skipReason(p, 100)).toBeNull();
  });
  it("skips dependencies, lockfiles, generated and binary files", () => {
    expect(skipReason("node_modules/x/index.js", 10)).toBe("ignored");
    expect(skipReason("pnpm-lock.yaml", 10)).toBe("lockfile");
    expect(skipReason("dist/app.min.js", 10)).toBe("ignored");
    expect(skipReason("assets/app.min.js", 10)).toBe("generated");
    expect(skipReason("api/x_pb2.py", 10)).toBe("generated");
    expect(skipReason("logo.png", 10)).toBe("binary");
    expect(skipReason("src/big.ts", 500_000)).toBe("too_large");
  });
  it("spots minified text", () => {
    expect(looksMinified("x".repeat(5_000))).toBe(true);
    expect(looksMinified("const a = 1;\n".repeat(400))).toBe(false);
  });
});

describe("buildImportGraph", () => {
  it("resolves JS/TS relative imports, index files, .js→.ts and tsconfig paths", () => {
    const g = buildImportGraph([
      file("tsconfig.json", '{ // comment\n "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }'),
      file("src/index.ts", 'import { a } from "./lib/a.js";\nexport * from "./util";\nimport x from "@/lib/b";'),
      file("src/lib/a.ts", "export const a = 1;"),
      file("src/lib/b.ts", 'const c = require("../util/index");'),
      file("src/util/index.ts", "export {};"),
      file("package.json", '{ "name": "demo", "main": "./dist/index.js" }'),
    ]);
    expect(g.edges).toEqual(
      expect.arrayContaining([
        ["src/index.ts", "src/lib/a.ts"],
        ["src/index.ts", "src/util/index.ts"],
        ["src/index.ts", "src/lib/b.ts"],
        ["src/lib/b.ts", "src/util/index.ts"],
      ]),
    );
    expect(g.entries).toContain("src/index.ts");
    // The import line behind each link, for the map's evidence panel.
    expect(g.lines.get("src/index.ts\u0000src/lib/a.ts")).toBe(1);
    expect(g.lines.get("src/index.ts\u0000src/lib/b.ts")).toBe(3);
    expect(g.lines.get("src/lib/b.ts\u0000src/util/index.ts")).toBe(1);
  });

  it("resolves Python absolute and relative imports", () => {
    const g = buildImportGraph([
      file("pkg/__init__.py", ""),
      file("pkg/app.py", "from .db import connect\nfrom pkg import routes\nimport pkg.util\n"),
      file("pkg/db.py", ""),
      file("pkg/routes.py", ""),
      file("pkg/util.py", ""),
      file("pkg/__main__.py", "from pkg.app import run"),
    ]);
    expect(g.edges).toEqual(
      expect.arrayContaining([
        ["pkg/app.py", "pkg/db.py"],
        ["pkg/app.py", "pkg/routes.py"],
        ["pkg/app.py", "pkg/util.py"],
        ["pkg/__main__.py", "pkg/app.py"],
      ]),
    );
    expect(g.entries).toContain("pkg/__main__.py");
  });

  it("resolves Go packages inside the module and finds main", () => {
    const g = buildImportGraph([
      file("go.mod", "module example.com/svc\n"),
      file("cmd/svc/main.go", 'package main\nimport (\n  "fmt"\n  "example.com/svc/internal/store"\n)\nfunc main() {}'),
      file("internal/store/store.go", "package store"),
    ]);
    expect(g.edges).toEqual([["cmd/svc/main.go", "internal/store/store.go"]]);
    expect(g.entries).toContain("cmd/svc/main.go");
  });

  it("resolves Rust mod and use crate::", () => {
    const g = buildImportGraph([
      file("src/main.rs", "mod config;\nuse crate::net::client;\n"),
      file("src/config.rs", ""),
      file("src/net/mod.rs", "pub mod client;"),
      file("src/net/client.rs", ""),
    ]);
    expect(g.edges).toEqual(
      expect.arrayContaining([
        ["src/main.rs", "src/config.rs"],
        ["src/main.rs", "src/net/client.rs"],
        ["src/net/mod.rs", "src/net/client.rs"],
      ]),
    );
    expect(summarizeGraph(g)).toContain("Entry points");
  });
});

describe("packRepo", () => {
  it("reads README, manifests and entries before tests, and cuts at the budget", () => {
    const entries = new Set(["src/index.ts"]);
    const fanIn = new Map<string, number>();
    expect(priorityOf("README.md", entries, fanIn)).toBeLessThan(priorityOf("src/index.ts", entries, fanIn));
    expect(priorityOf("src/index.ts", entries, fanIn)).toBeLessThan(priorityOf("src/deep/x.ts", entries, fanIn));
    expect(priorityOf("src/x.ts", entries, fanIn)).toBeLessThan(priorityOf("tests/x.test.ts", entries, fanIn));
    expect(priorityOf("examples/demo/package.json", entries, fanIn)).toBeGreaterThan(priorityOf("src/x.ts", entries, fanIn));

    const files = [file("README.md", "hello"), file("src/index.ts", "a\n".repeat(50)), file("tests/big.test.ts", "b\n".repeat(5_000))];
    const pack = packRepo(files, { edges: [], lines: new Map(), entries: ["src/index.ts"] }, 500);
    expect(pack.included.map((f) => f.path)).toEqual(["README.md", "src/index.ts"]);
    expect(pack.overBudget.map((f) => f.path)).toEqual(["tests/big.test.ts"]);
    expect(pack.text).toContain("=== src/index.ts (51 lines) ===\n1| a");
  });
});
