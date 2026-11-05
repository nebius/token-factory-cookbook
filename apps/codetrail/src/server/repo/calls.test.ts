import { describe, expect, it } from "vitest";
import { callsOf } from "./calls";
import type { RepoFile } from "./github";
import { buildImportGraph } from "./graph";

const file = (path: string, text: string) => ({ path, text, lines: text.split("\n").length, tokens: 1 }) as unknown as RepoFile;
const of = (files: RepoFile[], path: string) => callsOf(files, buildImportGraph(files), path);

describe("callsOf: JS/TS", () => {
  const files = [
    file("src/app.ts", ['import { route as r } from "./router";', 'import * as util from "./util";', "import Store from './store';", "", "export function start() {", "  const s = new Store();", "  r('/');", "  util.log('up');", "  helper();", "}", "", "const helper = () => 1;", "", "class Server {", "  listen() {", "    this.boot();", "  }", "  boot() {}", "}"].join("\n")),
    file("src/router.ts", "export function route(path: string) {\n  return path;\n}\n"),
    file("src/util.ts", "export const log = (m: string) => console.log(m);\n"),
    file("src/store.ts", "export default class Store {\n  constructor() {}\n}\n"),
    file("src/main.ts", 'import { start } from "./app";\nstart();\n'),
  ];
  const c = of(files, "src/app.ts");

  it("finds functions, methods and arrow functions", () => {
    expect(c.language).toBe("js");
    expect(c.functions.map((f) => f.id)).toEqual(expect.arrayContaining(["start", "helper", "Server.listen", "Server.boot"]));
    expect(c.functions.find((f) => f.id === "start")).toMatchObject({ line: 5, end: 10 });
  });

  it("resolves aliased, namespace, default and local calls across files", () => {
    const from = (name: string) => c.calls.find((x) => x.from === "start" && x.name === name)?.target;
    expect(from("r")).toEqual({ file: "src/router.ts", name: "route", line: 1 });
    expect(from("util.log")).toEqual({ file: "src/util.ts", name: "log", line: 1 });
    expect(from("new Store")).toEqual({ file: "src/store.ts", name: "Store.constructor", line: 2 });
    expect(from("helper")).toMatchObject({ file: "src/app.ts", name: "helper" });
    expect(c.calls.find((x) => x.from === "Server.listen" && x.name === "this.boot")?.target).toMatchObject({ name: "Server.boot" });
  });

  it("reads CommonJS exports and requires", () => {
    const cjs = [
      file("lib/index.js", "const helper = require('./helper');\nmodule.exports = (opts) => helper.make(opts);\n"),
      file("lib/helper.js", "exports.make = function (o) {\n  return o;\n};\n"),
      file("test/a.js", "const lib = require('../lib');\nlib({});\n"),
    ];
    const c = of(cjs, "lib/index.js");
    expect(c.calls.find((x) => x.name === "helper.make")?.target).toEqual({ file: "lib/helper.js", name: "make", line: 1 });
    expect(c.callers).toEqual([{ file: "test/a.js", fn: "(top level)", line: 2, to: "module.exports" }]);
  });

  it("lists callers from the files that import it", () => {
    expect(c.callers).toEqual([{ file: "src/main.ts", fn: "(top level)", line: 2, to: "start" }]);
  });
});

describe("callsOf: Python and Go", () => {
  it("matches Python calls by name in the file and the files it imports", () => {
    const files = [
      file("pkg/app.py", "from .db import connect\n\nclass App:\n    def run(self):\n        self.setup()\n        connect('x')\n\n    def setup(self):\n        pass\n"),
      file("pkg/db.py", "def connect(url):\n    return url\n"),
      file("pkg/__init__.py", ""),
    ];
    const c = of(files, "pkg/app.py");
    expect(c.functions.map((f) => f.id)).toEqual(["App.run", "App.setup"]);
    expect(c.calls.find((x) => x.name === "self.setup")?.target).toMatchObject({ name: "App.setup" });
    expect(c.calls.find((x) => x.name === "connect")?.target).toEqual({ file: "pkg/db.py", name: "connect", line: 1 });
    expect(of(files, "pkg/db.py").callers).toEqual([{ file: "pkg/app.py", fn: "App.run", line: 6, to: "connect" }]);
  });

  it("reads Go functions and methods, and calls within the package", () => {
    const files = [
      file("go.mod", "module example.com/x\n"),
      file("server/server.go", 'package server\n\nfunc (s *Server) Start() {\n\ts.listen()\n\tlogf("up")\n}\n\nfunc (s *Server) listen() {\n}\n'),
      file("server/log.go", "package server\n\nfunc logf(m string) {\n}\n"),
    ];
    const c = of(files, "server/server.go");
    expect(c.functions.map((f) => f.id)).toEqual(["Server.Start", "Server.listen"]);
    expect(c.calls.find((x) => x.name === "logf")?.target).toEqual({ file: "server/log.go", name: "logf", line: 3 });
    expect(c.calls.find((x) => x.name === "s.listen")?.target).toMatchObject({ name: "Server.listen" });
  });

  it("says when a language isn't covered", () => expect(of([file("a.rb", "def x; end")], "a.rb").language).toBeNull());
});
