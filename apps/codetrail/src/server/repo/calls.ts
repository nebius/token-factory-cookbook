// Function calls, worked out from the code (no AI): the functions in a file, what each one calls, and who calls
// them from the files that import it. JS and TS are read with the TypeScript compiler's parser, so imports and
// aliases resolve exactly; Python and Go are read line by line and calls are matched by name to the functions in
// the files they import. A best effort, like the import graph: a call we can't place keeps just its name.
import path from "node:path/posix";
import ts from "typescript";
import type { RepoFile } from "./github";
import { jsResolver, type ImportGraph } from "./graph";

export type Fn = { id: string; name: string; line: number; end: number };
type Target = { file: string; name: string; line: number };
export type Call = { from: string; name: string; line: number; target: Target | null };
export type Caller = { file: string; fn: string; line: number; to: string };
export type Calls = { file: string; language: "js" | "py" | "go" | null; functions: Fn[]; calls: Call[]; callers: Caller[] };

const MAX_FNS = 150;
const MAX_IMPORTERS = 30;
const MODULE = "(top level)";

const isJs = (p: string) => /\.(m?[jt]sx?|c[jt]s)$/.test(p);
const langOf = (p: string): Calls["language"] => (isJs(p) ? "js" : p.endsWith(".py") ? "py" : p.endsWith(".go") ? "go" : null);

// --- JavaScript / TypeScript ---------------------------------------------------------------------------

type JsFile = {
  fns: Fn[];
  /** Calls by the function they're in: the callee as written ("a", "ns.b", "this.c"). */
  calls: { from: string; callee: string; line: number }[];
  /** Local name → where it was imported from and under which name ("default", "*" for a namespace). */
  imports: Map<string, { spec: string; name: string }>;
  /** Exported name → the function's local name. */
  exports: Map<string, string>;
};

const jsCache = new WeakMap<RepoFile, JsFile>();

function readJs(f: RepoFile): JsFile {
  const hit = jsCache.get(f);
  if (hit) return hit;
  const kind = /x$/.test(f.path) ? ts.ScriptKind.TSX : /\.m?[jc]?js$/.test(f.path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(f.path, f.text, ts.ScriptTarget.Latest, true, kind);
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const endOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getEnd()).line + 1;
  const out: JsFile = { fns: [], calls: [], imports: new Map(), exports: new Map() };
  const exported = (n: ts.Node) => ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (n: ts.Node) => ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

  const addFn = (name: string, node: ts.Node) => {
    if (out.fns.length >= MAX_FNS || out.fns.some((x) => x.id === name)) return name;
    out.fns.push({ id: name, name, line: lineOf(node), end: endOf(node) });
    return name;
  };
  const calleeText = (e: ts.Expression): string | null => {
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e)) {
      const left = e.expression.kind === ts.SyntaxKind.ThisKeyword ? "this" : ts.isIdentifier(e.expression) ? e.expression.text : null;
      return left ? `${left}.${e.name.text}` : e.name.text;
    }
    return null;
  };

  const visit = (node: ts.Node, owner: string, cls: string | null) => {
    let inside = owner;
    if (ts.isFunctionDeclaration(node) && node.body) {
      const name = node.name?.text ?? "default";
      inside = addFn(name, node);
      if (exported(node)) out.exports.set(isDefault(node) ? "default" : name, name);
    } else if ((ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) && node.body && cls) {
      const name = ts.isConstructorDeclaration(node) ? "constructor" : node.name && ts.isIdentifier(node.name) ? node.name.text : null;
      if (name) inside = addFn(`${cls}.${name}`, node);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      inside = addFn(node.name.text, node);
      const stmt = node.parent?.parent;
      if (stmt && exported(stmt)) out.exports.set(node.name.text, node.name.text);
    } else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) && owner === MODULE) {
      inside = addFn(node.name.text, node);
    } else if (ts.isClassDeclaration(node) && node.name) {
      if (exported(node)) out.exports.set(isDefault(node) ? "default" : node.name.text, `${node.name.text}.constructor`);
      node.members.forEach((m) => visit(m, owner, node.name!.text));
      return;
    } else if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      const c = node.importClause;
      if (c?.name) out.imports.set(c.name.text, { spec, name: "default" });
      const b = c?.namedBindings;
      if (b && ts.isNamespaceImport(b)) out.imports.set(b.name.text, { spec, name: "*" });
      if (b && ts.isNamedImports(b)) for (const el of b.elements) out.imports.set(el.name.text, { spec, name: (el.propertyName ?? el.name).text });
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && owner === MODULE && ts.isPropertyAccessExpression(node.left)) {
      // CommonJS: module.exports = x / { a, b } / function…, and exports.a = function….
      const left = node.left.getText(sf);
      const right = node.right;
      if (left === "module.exports") {
        if (ts.isIdentifier(right)) out.exports.set("default", right.text);
        else if (ts.isArrowFunction(right) || ts.isFunctionExpression(right) || ts.isClassExpression(right)) {
          out.exports.set("default", addFn("module.exports", right));
          ts.forEachChild(right, (c) => visit(c, "module.exports", ts.isClassExpression(right) ? (right.name?.text ?? null) : cls));
          return;
        } else if (ts.isObjectLiteralExpression(right)) {
          for (const prop of right.properties) {
            if (ts.isShorthandPropertyAssignment(prop)) out.exports.set(prop.name.text, prop.name.text);
            else if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && ts.isIdentifier(prop.initializer)) out.exports.set(prop.name.text, prop.initializer.text);
          }
        }
      } else if (/^(module\.)?exports\.\w+$/.test(left) && (ts.isArrowFunction(right) || ts.isFunctionExpression(right))) {
        const name = node.left.name.text;
        out.exports.set(name, addFn(name, right));
        ts.forEachChild(right, (c) => visit(c, name, cls));
        return;
      }
    } else if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) {
      out.exports.set("default", node.expression.text);
    } else if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause) && !node.moduleSpecifier) {
      for (const el of node.exportClause.elements) out.exports.set(el.name.text, (el.propertyName ?? el.name).text);
    } else if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.expression) {
      // require("x") bound to a name: const x = require("./x") / const { a } = require("./x").
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const decl = node.parent;
        if (decl && ts.isVariableDeclaration(decl)) {
          if (ts.isIdentifier(decl.name)) out.imports.set(decl.name.text, { spec: node.arguments[0].text, name: "*" });
          else if (ts.isObjectBindingPattern(decl.name))
            for (const el of decl.name.elements) if (ts.isIdentifier(el.name)) out.imports.set(el.name.text, { spec: node.arguments[0].text, name: el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text });
        }
      } else {
        const callee = calleeText(node.expression);
        if (callee) out.calls.push({ from: owner, callee: ts.isNewExpression(node) ? `new ${callee}` : callee, line: lineOf(node) });
      }
    }
    ts.forEachChild(node, (c) => visit(c, inside, cls));
  };
  visit(sf, MODULE, null);
  jsCache.set(f, out);
  return out;
}

function jsCalls(files: RepoFile[], graph: ImportGraph, file: RepoFile): Omit<Calls, "file" | "language"> {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const { resolveJs } = jsResolver(files);
  const here = readJs(file);
  const fnLine = (f: JsFile, name: string) => f.fns.find((x) => x.id === name)?.line ?? 1;
  /** Where an imported name lands: the file, and the function's local name there. */
  const land = (from: string, spec: string, name: string, member?: string): Target | null => {
    const target = resolveJs(from, spec);
    const f = target ? byPath.get(target) : undefined;
    if (!f) return null;
    const there = readJs(f);
    const wanted = name === "*" ? (member ?? "default") : name;
    const local = there.exports.get(wanted) ?? (there.fns.some((x) => x.id === wanted) ? wanted : null);
    if (local) return { file: f.path, name: local, line: fnLine(there, local) };
    // Re-exported from another file: follow one level.
    return null;
  };
  const resolve = (callee: string, cls: string | null): Target | null => {
    const bare = callee.replace(/^new /, "");
    if (bare.startsWith("this.") && cls) {
      const id = `${cls}.${bare.slice(5)}`;
      if (here.fns.some((x) => x.id === id)) return { file: file.path, name: id, line: fnLine(here, id) };
    }
    const [head, member] = bare.split(".");
    if (!member && here.fns.some((x) => x.id === head)) return { file: file.path, name: head, line: fnLine(here, head) };
    if (callee.startsWith("new ") && here.fns.some((x) => x.id === `${head}.constructor`)) return { file: file.path, name: `${head}.constructor`, line: fnLine(here, `${head}.constructor`) };
    const imp = here.imports.get(head);
    if (imp) return land(file.path, imp.spec, member && imp.name === "*" ? "*" : imp.name, member);
    return null;
  };
  const calls: Call[] = [];
  const seen = new Set<string>();
  for (const c of here.calls) {
    const key = `${c.from}>${c.callee}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({ from: c.from, name: c.callee, line: c.line, target: resolve(c.callee, c.from.includes(".") ? c.from.split(".")[0] : null) });
  }

  // Callers: files that import this one, and their calls that land here.
  const callers: Caller[] = [];
  for (const [from, to] of graph.edges) {
    if (to !== file.path || callers.length > 200) continue;
    const f = byPath.get(from);
    if (!f || !isJs(from)) continue;
    const there = readJs(f);
    for (const c of there.calls) {
      const [head, member] = c.callee.replace(/^new /, "").split(".");
      const imp = there.imports.get(head);
      if (!imp || resolveJs(from, imp.spec) !== file.path) continue;
      const wanted = imp.name === "*" ? (member ?? "default") : imp.name;
      const local = here.exports.get(wanted) ?? (here.fns.some((x) => x.id === wanted) ? wanted : null);
      if (local && here.fns.some((x) => x.id === local)) callers.push({ file: from, fn: c.from, line: c.line, to: local });
    }
    if (new Set(callers.map((c) => c.file)).size >= MAX_IMPORTERS) break;
  }
  return { functions: here.fns, calls, callers };
}

// --- Python and Go, line by line ---------------------------------------------------------------------------

const PY_SKIP = new Set(["if", "for", "while", "return", "elif", "and", "or", "not", "in", "with", "print", "len", "str", "int", "list", "dict", "set", "tuple", "isinstance", "super", "range", "enumerate", "getattr", "setattr", "hasattr", "type", "bool", "float", "open", "sorted", "min", "max", "zip", "map", "filter", "any", "all", "lambda", "yield", "await", "assert", "except", "raise", "del"]);
const GO_SKIP = new Set(["if", "for", "switch", "return", "func", "make", "len", "append", "new", "panic", "recover", "cap", "copy", "delete", "close", "string", "int", "int64", "byte", "error", "go", "defer", "select", "range", "uint", "float64", "bool", "rune"]);

type Lined = { fns: Fn[]; calls: { from: string; callee: string; line: number }[] };

function readPy(text: string): Lined {
  const lines = text.split("\n");
  const fns: Fn[] = [];
  const stack: { indent: number; cls: string }[] = [];
  lines.forEach((l, i) => {
    if (!l.trim() || l.trim().startsWith("#")) return;
    const indent = l.length - l.trimStart().length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const cls = l.match(/^\s*class\s+(\w+)/);
    if (cls) stack.push({ indent, cls: cls[1] });
    const def = l.match(/^\s*(?:async\s+)?def\s+(\w+)\s*\(/);
    if (def && fns.length < MAX_FNS) {
      const owner = stack.filter((s) => s.indent < indent).pop();
      const name = owner ? `${owner.cls}.${def[1]}` : def[1];
      let end = i + 1;
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].trim()) continue;
        if (lines[j].length - lines[j].trimStart().length <= indent) break;
        end = j + 1;
      }
      fns.push({ id: name, name, line: i + 1, end });
    }
  });
  return { fns, calls: callsIn(lines, fns, /(?<![\w.])((?:self\.|\w+\.)?\w+)\s*\(/g, PY_SKIP, /^\s*(?:async\s+)?def\s/) };
}

function readGo(text: string): Lined {
  const lines = text.split("\n");
  const fns: Fn[] = [];
  lines.forEach((l, i) => {
    const m = l.match(/^func\s+(?:\(\s*\w*\s*\*?(\w+)[^)]*\)\s*)?(\w+)\s*[[(]/);
    if (!m || fns.length >= MAX_FNS) return;
    let end = i + 1;
    for (let j = i + 1; j < lines.length; j++) {
      end = j + 1;
      if (/^}/.test(lines[j])) break;
    }
    const name = m[1] ? `${m[1]}.${m[2]}` : m[2];
    fns.push({ id: name, name, line: i + 1, end });
  });
  return { fns, calls: callsIn(lines, fns, /(?<![\w.])((?:\w+\.)?\w+)\s*\(/g, GO_SKIP, /^func\s/) };
}

/** Every `name(` inside each function, skipping keywords, built-ins and the definition line itself. */
function callsIn(lines: string[], fns: Fn[], pattern: RegExp, skip: Set<string>, defLine: RegExp) {
  const calls: Lined["calls"] = [];
  for (const fn of fns) {
    const seen = new Set<string>();
    for (let i = fn.line - 1; i < fn.end; i++) {
      const l = lines[i].replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""').replace(/#.*$|\/\/.*$/, "");
      if (i === fn.line - 1 && defLine.test(l)) continue;
      for (const m of l.matchAll(pattern)) {
        const callee = m[1];
        const last = callee.split(".").pop()!;
        if (skip.has(callee) || skip.has(last) || seen.has(callee)) continue;
        seen.add(callee);
        calls.push({ from: fn.id, callee, line: i + 1 });
      }
    }
  }
  return calls;
}

function linedCalls(files: RepoFile[], graph: ImportGraph, file: RepoFile, read: (t: string) => Lined): Omit<Calls, "file" | "language"> {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const cache = new Map<string, Lined>();
  const get = (p: string) => {
    if (!cache.has(p)) cache.set(p, read(byPath.get(p)?.text ?? ""));
    return cache.get(p)!;
  };
  const here = get(file.path);
  // Where a name can come from: this file, files in the same folder (Go packages), and the files it imports.
  const dir = path.dirname(file.path);
  const near = [
    ...(file.path.endsWith(".go") ? files.filter((f) => f.path !== file.path && f.path.endsWith(".go") && !f.path.endsWith("_test.go") && path.dirname(f.path) === dir).map((f) => f.path) : []),
    ...graph.edges.filter(([a]) => a === file.path).map(([, b]) => b),
  ];
  const find = (callee: string): Target | null => {
    const parts = callee.split(".");
    const name = parts[parts.length - 1];
    // "self.x()", "s.x()": a method of that name in this file (Python's self, Go's receiver).
    const own = here.fns.find((f) => f.id === callee || f.name === callee || (parts.length > 1 && f.id.endsWith(`.${name}`)));
    if (own) return { file: file.path, name: own.id, line: own.line };
    for (const p of near) {
      const hit = get(p).fns.find((f) => f.name === name || f.id.endsWith(`.${name}`));
      if (hit) return { file: p, name: hit.id, line: hit.line };
    }
    return null;
  };
  const calls: Call[] = here.calls.map((c) => ({ from: c.from, name: c.callee, line: c.line, target: find(c.callee) }));
  const callers: Caller[] = [];
  const importers = [
    ...graph.edges.filter(([, b]) => b === file.path).map(([a]) => a),
    ...(file.path.endsWith(".go") ? near.filter((p) => path.dirname(p) === dir) : []),
  ].slice(0, MAX_IMPORTERS);
  for (const p of importers) {
    for (const c of get(p).calls) {
      const name = c.callee.split(".").pop()!;
      const hit = here.fns.find((f) => f.name === name || f.id.endsWith(`.${name}`));
      if (hit) callers.push({ file: p, fn: c.from, line: c.line, to: hit.id });
    }
  }
  return { functions: here.fns, calls, callers };
}

/** The functions in `file`, what they call, and who calls them. */
export function callsOf(files: RepoFile[], graph: ImportGraph, file: string): Calls {
  const f = files.find((x) => x.path === file);
  const language = langOf(file);
  if (!f || !language) return { file, language: f ? null : language, functions: [], calls: [], callers: [] };
  const body = language === "js" ? jsCalls(files, graph, f) : linedCalls(files, graph, f, language === "py" ? readPy : readGo);
  return { file, language, ...body };
}
