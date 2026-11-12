// The import graph and entry points, worked out from the code itself (no AI). The map uses it to mark which
// connections the code really has, and the prompt gets a short summary of it. It's a best effort per
// language: an import we can't resolve (a package, a dynamic path) is simply left out.
import path from "node:path/posix";
import type { RepoFile } from "./github";

export type ImportGraph = {
  /** [from, to] file paths, both inside the repo. */
  edges: [string, string][];
  /** The line of the first import behind each edge, keyed "from\0to": the evidence for a link on the map. */
  lines: Map<string, number>;
  /** Files a program or a request starts from. */
  entries: string[];
};

const JS_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".astro"];
const isJs = (p: string) => /\.(m?[jt]sx?|c[jt]s|vue|svelte|astro)$/.test(p);

function stripJsonComments(text: string) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1").replace(/,(\s*[}\]])/g, "$1");
}

function parseJson<T>(text: string | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(stripJsonComments(text)) as T;
  } catch {
    return null;
  }
}

/**
 * How a JS/TS import resolves to a file in the repo: relative paths (with .js→.ts and index files), tsconfig
 * "paths" aliases, "@/" and "~/", and workspace packages by name. Null for anything outside the repo.
 */
export function jsResolver(files: RepoFile[]) {
  const has = (p: string) => byPathOf(files).has(p);
  const resolveJsFile = (p: string): string | null => {
    const clean = path.normalize(p).replace(/^\.\//, "");
    if (has(clean) && !clean.endsWith("/")) return clean;
    const noJs = clean.replace(/\.(m?js|cjs|jsx)$/, ""); // ESM TypeScript imports "./x.js" for x.ts.
    for (const base of [clean, noJs]) {
      for (const ext of JS_EXT) if (has(base + ext)) return base + ext;
      for (const ext of JS_EXT) if (has(`${base}/index${ext}`)) return `${base}/index${ext}`;
    }
    return null;
  };

  // tsconfig "paths" ("@/*": ["./src/*"]) and workspace packages (name → folder), from every config found.
  const aliases: { prefix: string; targets: string[]; dir: string }[] = [];
  const packages = new Map<string, string>();
  for (const f of files) {
    const name = path.basename(f.path);
    const dir = path.dirname(f.path) === "." ? "" : path.dirname(f.path);
    if (/^[jt]sconfig.*\.json$/.test(name)) {
      const cfg = parseJson<{ compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }>(f.text);
      const baseUrl = path.join(dir, cfg?.compilerOptions?.baseUrl ?? ".");
      for (const [key, targets] of Object.entries(cfg?.compilerOptions?.paths ?? {})) {
        aliases.push({ prefix: key.replace(/\*$/, ""), targets: targets.map((t) => path.join(baseUrl, t.replace(/\*$/, ""))), dir });
      }
    }
    if (name === "package.json") {
      const pkg = parseJson<{ name?: string }>(f.text);
      if (pkg?.name) packages.set(pkg.name, dir);
    }
  }
  const resolveJs = (from: string, spec: string): string | null => {
    if (spec.startsWith(".")) return resolveJsFile(path.join(path.dirname(from), spec));
    for (const a of aliases) {
      if (a.prefix && spec.startsWith(a.prefix) && (from.startsWith(a.dir) || a.dir === "")) {
        for (const t of a.targets) {
          const hit = resolveJsFile(path.join(t, spec.slice(a.prefix.length)));
          if (hit) return hit;
        }
      }
    }
    if (spec.startsWith("@/") || spec.startsWith("~/")) {
      return resolveJsFile(path.join("src", spec.slice(2))) ?? resolveJsFile(spec.slice(2));
    }
    // A workspace package: "@acme/ui" or "@acme/ui/button".
    const parts = spec.split("/");
    const pkgName = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    const dir = packages.get(pkgName);
    if (dir !== undefined) {
      const sub = spec.slice(pkgName.length).replace(/^\//, "");
      return resolveJsFile(path.join(dir, "src", sub || "index")) ?? resolveJsFile(path.join(dir, sub || "index"));
    }
    return null;
  };
  return { resolveJs, resolveJsFile };
}

const pathSets = new WeakMap<RepoFile[], Set<string>>();
const byPathOf = (files: RepoFile[]) => {
  let set = pathSets.get(files);
  if (!set) pathSets.set(files, (set = new Set(files.map((f) => f.path))));
  return set;
};

export function buildImportGraph(files: RepoFile[]): ImportGraph {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const has = (p: string) => byPath.has(p);
  const edges = new Set<string>();
  const lines = new Map<string, number>();
  // The file being read and where its lines start, so a match's offset becomes a line number.
  let starts: number[] = [];
  const lineAt = (offset: number) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const add = (from: string, to: string | null | undefined, offset?: number) => {
    if (!to || to === from || !has(to)) return;
    const key = `${from}\u0000${to}`;
    edges.add(key);
    if (offset !== undefined && !lines.has(key)) lines.set(key, lineAt(offset));
  };

  // --- JavaScript / TypeScript -------------------------------------------------------------------
  const { resolveJs, resolveJsFile } = jsResolver(files);
  const JS_IMPORT = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  // --- Python ------------------------------------------------------------------------------------
  const pyModules = new Map<string, string>();
  for (const f of files) {
    if (!f.path.endsWith(".py")) continue;
    const dotted = f.path.replace(/\.py$/, "").replace(/\/__init__$/, "").split("/");
    // "src/pkg/mod.py" is imported as "pkg.mod": register every suffix of the path.
    for (let i = 0; i < dotted.length; i++) {
      const key = dotted.slice(i).join(".");
      if (!pyModules.has(key)) pyModules.set(key, f.path);
    }
  }
  const resolvePy = (from: string, mod: string, names: string[]): string[] => {
    let full = mod;
    if (mod.startsWith(".")) {
      const dots = mod.match(/^\.+/)![0].length;
      const baseParts = path.dirname(from).split("/").filter((p) => p && p !== ".");
      const base = baseParts.slice(0, baseParts.length - (dots - 1)).join(".");
      full = [base, mod.slice(dots)].filter(Boolean).join(".");
    }
    // "from pkg import mod" can name a module, not just a symbol.
    const hits = names.map((n) => pyModules.get(`${full}.${n}`)).filter((h): h is string => !!h);
    if (hits.length) return hits;
    for (let parts = full.split("."); parts.length; parts = parts.slice(0, -1)) {
      const hit = pyModules.get(parts.join("."));
      if (hit) return [hit];
    }
    return [];
  };

  // --- Go ----------------------------------------------------------------------------------------
  const goModules = files
    .filter((f) => path.basename(f.path) === "go.mod")
    .map((f) => ({ module: f.text.match(/^module\s+(\S+)/m)?.[1] ?? "", dir: path.dirname(f.path) === "." ? "" : path.dirname(f.path) }))
    .filter((m) => m.module);
  const goDirs = new Map<string, string[]>();
  for (const f of files) {
    if (!f.path.endsWith(".go") || f.path.endsWith("_test.go")) continue;
    const d = path.dirname(f.path) === "." ? "" : path.dirname(f.path);
    goDirs.set(d, [...(goDirs.get(d) ?? []), f.path]);
  }

  // --- Suffix index (Java, Kotlin, C/C++ includes) -----------------------------------------------
  const bySuffix = (suffix: string) => files.find((f) => f.path === suffix || f.path.endsWith(`/${suffix}`))?.path ?? null;

  for (const f of files) {
    const p = f.path;
    starts = [0];
    for (let i = f.text.indexOf("\n"); i >= 0; i = f.text.indexOf("\n", i + 1)) starts.push(i + 1);
    if (isJs(p)) {
      for (const m of f.text.matchAll(JS_IMPORT)) add(p, resolveJs(p, m[1] ?? m[2] ?? m[3]), m.index);
    } else if (p.endsWith(".py")) {
      // "from x import a, b" on one line, or a parenthesised list over several.
      for (const m of f.text.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n#]+)/gm)) {
        const names = m[2].replace(/[()]/g, "").split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
        for (const hit of resolvePy(p, m[1], names)) add(p, hit, m.index);
      }
      for (const m of f.text.matchAll(/^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm)) {
        for (const mod of m[1].split(",")) for (const hit of resolvePy(p, mod.trim(), [])) add(p, hit, m.index);
      }
    } else if (p.endsWith(".go")) {
      const block = f.text.match(/import\s*\(([\s\S]*?)\)/)?.[1] ?? "";
      const single = [...f.text.matchAll(/^import\s+(?:\w+\s+)?"([^"]+)"/gm)].map((m) => m[1]);
      const specs = [...[...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]), ...single];
      for (const spec of specs) {
        for (const mod of goModules) {
          if (spec === mod.module || spec.startsWith(`${mod.module}/`)) {
            const dir = path.join(mod.dir, spec.slice(mod.module.length).replace(/^\//, "")).replace(/^\.$/, "");
            for (const target of goDirs.get(dir) ?? []) add(p, target, f.text.indexOf(`"${spec}"`));
          }
        }
      }
    } else if (p.endsWith(".rs")) {
      const dir = path.dirname(p);
      const own = /(^|\/)(mod|lib|main)\.rs$/.test(p) ? dir : p.replace(/\.rs$/, "");
      for (const m of f.text.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm)) {
        add(p, has(path.join(own, `${m[1]}.rs`)) ? path.join(own, `${m[1]}.rs`) : path.join(own, m[1], "mod.rs"), m.index);
      }
      const crateRoot = (() => {
        for (let d = dir; d && d !== "."; d = path.dirname(d)) if (has(`${d}/lib.rs`) || has(`${d}/main.rs`)) return d;
        return has("src/lib.rs") || has("src/main.rs") ? "src" : dir;
      })();
      for (const m of f.text.matchAll(/^\s*(?:pub\s+)?use\s+crate::([\w:]+)/gm)) {
        const parts = m[1].split("::");
        for (let n = parts.length; n > 0; n--) {
          const base = path.join(crateRoot, ...parts.slice(0, n));
          const hit = has(`${base}.rs`) ? `${base}.rs` : has(`${base}/mod.rs`) ? `${base}/mod.rs` : null;
          if (hit) {
            add(p, hit, m.index);
            break;
          }
        }
      }
    } else if (/\.(java|kt|kts|scala)$/.test(p)) {
      for (const m of f.text.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+)\s*;?/gm)) {
        const rel = m[1].replace(/\.\*$/, "").replace(/\./g, "/");
        add(p, bySuffix(`${rel}.java`) ?? bySuffix(`${rel}.kt`) ?? bySuffix(`${rel}.scala`), m.index);
      }
    } else if (/\.(c|cc|cpp|cxx|h|hh|hpp|m|mm)$/.test(p)) {
      for (const m of f.text.matchAll(/^\s*#\s*(?:include|import)\s+"([^"]+)"/gm)) {
        const local = path.join(path.dirname(p), m[1]);
        add(p, has(local) ? local : bySuffix(m[1]), m.index);
      }
    } else if (p.endsWith(".rb")) {
      for (const m of f.text.matchAll(/require_relative\s+['"]([^'"]+)['"]/g)) add(p, `${path.join(path.dirname(p), m[1])}.rb`.replace(/\.rb\.rb$/, ".rb"), m.index);
    }
  }

  return {
    edges: [...edges].map((e) => e.split("\u0000") as [string, string]),
    lines,
    entries: findEntries(files, has, resolveJsFile),
  };
}

/** Where programs and requests start, from manifests and well-known file names. */
function findEntries(files: RepoFile[], has: (p: string) => boolean, resolveJsFile: (p: string) => string | null): string[] {
  const out = new Set<string>();
  const addJs = (dir: string, target: unknown) => {
    if (typeof target !== "string") return;
    const hit = resolveJsFile(path.join(dir, target)) ?? resolveJsFile(path.join(dir, target.replace(/^(\.\/)?(dist|lib|build)\//, "$1src/")));
    if (hit) out.add(hit);
  };
  for (const f of files) {
    const name = path.basename(f.path);
    const dir = path.dirname(f.path) === "." ? "" : path.dirname(f.path);
    if (name === "package.json") {
      const pkg = parseJson<{ main?: string; module?: string; bin?: string | Record<string, string>; exports?: unknown; scripts?: Record<string, string> }>(f.text);
      if (!pkg) continue;
      addJs(dir, pkg.main);
      addJs(dir, pkg.module);
      if (typeof pkg.bin === "string") addJs(dir, pkg.bin);
      else for (const b of Object.values(pkg.bin ?? {})) addJs(dir, b);
      const walk = (v: unknown) => {
        if (typeof v === "string") addJs(dir, v);
        else if (v && typeof v === "object") Object.values(v).forEach(walk);
      };
      walk(pkg.exports);
      for (const script of [pkg.scripts?.start, pkg.scripts?.dev, pkg.scripts?.serve]) {
        const file = script?.match(/(?:node|tsx|ts-node|bun|deno run[^ ]*)\s+(?:--?\S+\s+)*([\w./-]+\.[mc]?[jt]sx?)/)?.[1];
        if (file) addJs(dir, file);
      }
    } else if (name === "pyproject.toml") {
      for (const m of f.text.matchAll(/^\s*[\w-]+\s*=\s*"([\w.]+):\w+"/gm)) {
        const mod = m[1].replace(/\./g, "/");
        for (const c of [`${mod}.py`, `src/${mod}.py`, `${mod}/__init__.py`, `src/${mod}/__init__.py`]) if (has(path.join(dir, c))) out.add(path.join(dir, c));
      }
    }
  }
  for (const f of files) {
    const p = f.path;
    const name = path.basename(p);
    if (/^(__main__|manage|wsgi|asgi)\.py$/.test(name) || (p.endsWith(".py") && /^if\s+__name__\s*==\s*['"]__main__['"]/m.test(f.text) && p.split("/").length <= 3)) out.add(p);
    if (p.endsWith(".go") && /^package\s+main\b/m.test(f.text) && /^func\s+main\s*\(/m.test(f.text)) out.add(p);
    if (/(^|\/)src\/(main|lib)\.rs$/.test(p) || /(^|\/)src\/bin\/[^/]+\.rs$/.test(p)) out.add(p);
    if (/\.(java|kt)$/.test(p) && /static\s+void\s+main\s*\(|^fun\s+main\s*\(/m.test(f.text)) out.add(p);
    if (/(^|\/)(app|pages)\/(.*\/)?(page|layout|route)\.[jt]sx?$/.test(p) && p.split("/").length <= 5) out.add(p);
    if (/^(src\/)?(index|main|app|server|cli)\.[mc]?[jt]sx?$/.test(p)) out.add(p);
  }
  return [...out].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b)).slice(0, 25);
}

/** A few lines for the prompt: entry points, most-imported files, and which folders depend on which. */
export function summarizeGraph(graph: ImportGraph): string {
  const fanIn = new Map<string, number>();
  const dirEdges = new Map<string, number>();
  const dirOf = (p: string) => p.split("/").slice(0, Math.min(2, p.split("/").length - 1)).join("/") || "(root)";
  for (const [from, to] of graph.edges) {
    fanIn.set(to, (fanIn.get(to) ?? 0) + 1);
    const a = dirOf(from);
    const b = dirOf(to);
    if (a !== b) dirEdges.set(`${a} → ${b}`, (dirEdges.get(`${a} → ${b}`) ?? 0) + 1);
  }
  const top = [...fanIn].sort((a, b) => b[1] - a[1]).slice(0, 15);
  const dirs = [...dirEdges].sort((a, b) => b[1] - a[1]).slice(0, 25);
  return [
    `Entry points found in manifests and file names: ${graph.entries.join(", ") || "none found"}`,
    `Most imported files: ${top.map(([p, n]) => `${p} (${n})`).join(", ") || "none"}`,
    `Folder dependencies (imports between folders): ${dirs.map(([e, n]) => `${e} (${n})`).join("; ") || "none"}`,
  ].join("\n");
}
