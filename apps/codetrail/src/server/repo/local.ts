// Folders on this machine, for self-hosted personal use: every folder directly inside LOCAL_ROOT can be read like a
// GitHub repo, uncommitted changes included. Never on the hosted app. The "commit" is a fingerprint of the files
// (path, size, modified time), so editing a file makes a new read and an unchanged folder replays for free.
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { env } from "@/env";
import { LOCAL_OWNER } from "@/lib/ref";
import { collector, RepoError, type RepoInfo, type Snapshot } from "./github";
import { skipReason } from "./filter";

const MAX_FILES = 20_000;
const NAME = /^[A-Za-z0-9_.-]+$/;

const localEnabled = () => !!env.LOCAL_ROOT && env.AUTH_MODE === "none";

/** The folder for a name, only if it sits directly inside LOCAL_ROOT. */
function folderOf(name: string): string {
  if (!localEnabled()) throw new RepoError("Local folders are off. Set LOCAL_ROOT on a self-hosted Codetrail to read folders on this machine.", 404);
  const root = resolve(env.LOCAL_ROOT!);
  const dir = resolve(root, name);
  if (!NAME.test(name) || name.startsWith(".") || dir !== join(root, name) || !dir.startsWith(root + sep)) throw new RepoError("That isn't a folder in LOCAL_ROOT.", 404);
  return dir;
}

/** Folders that can be opened, newest first. */
export async function listLocal(): Promise<{ name: string; at: number }[]> {
  if (!localEnabled()) return [];
  const root = resolve(env.LOCAL_ROOT!);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((e) => e.isDirectory() && NAME.test(e.name) && !e.name.startsWith("."));
  const withTimes = await Promise.all(dirs.map(async (d) => ({ name: d.name, at: (await stat(join(root, d.name)).catch(() => null))?.mtimeMs ?? 0 })));
  return withTimes.sort((a, b) => b.at - a.at).slice(0, 200);
}

type Walked = { path: string; size: number; mtime: number };

/** Every file under `dir`, skipping ignored folders (node_modules, .git, build output…) without entering them. */
async function walk(dir: string): Promise<Walked[]> {
  const out: Walked[] = [];
  const visit = async (abs: string) => {
    for (const e of await readdir(abs, { withFileTypes: true }).catch(() => [])) {
      if (out.length >= MAX_FILES) return;
      const full = join(abs, e.name);
      const rel = relative(dir, full).split(sep).join("/");
      if (e.isDirectory()) {
        if (skipReason(`${rel}/x.ts`, 0) !== "ignored" && e.name !== ".git") await visit(full);
      } else if (e.isFile()) {
        const s = await stat(full).catch(() => null);
        if (s) out.push({ path: rel, size: s.size, mtime: Math.round(s.mtimeMs) });
      }
    }
  };
  await visit(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const fingerprint = (files: Walked[]) => createHash("sha1").update(files.map((f) => `${f.path}\0${f.size}\0${f.mtime}`).join("\n")).digest("hex");

/** Facts for a local folder, in the same shape as a GitHub repo's. No network. */
export async function localInfo(name: string): Promise<RepoInfo> {
  const dir = folderOf(name);
  const files = await walk(dir);
  if (!files.length) throw new RepoError("That folder is empty or couldn't be read.", 404);
  const readme = files.find((f) => /^readme\.mdx?$/i.test(f.path));
  const description = readme
    ? ((await readFile(join(dir, readme.path), "utf8").catch(() => ""))
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && !/^[#<!\[]/.test(l))
        ?.slice(0, 200) ?? null)
    : null;
  return {
    owner: LOCAL_OWNER,
    repo: name,
    description,
    stars: 0,
    defaultBranch: "working copy",
    ref: "working copy",
    sha: fingerprint(files),
    sizeKb: Math.round(files.reduce((a, f) => a + f.size, 0) / 1024),
    languages: {},
    htmlUrl: "",
    private: true,
  };
}

/** The folder's files, filtered exactly like a GitHub tarball. */
export async function readLocal(name: string): Promise<Snapshot> {
  const dir = folderOf(name);
  const collect = collector(name);
  for (const f of await walk(dir)) {
    const kind = collect.want(f.path, f.size);
    if (!kind) continue;
    const data = await readFile(join(dir, f.path)).catch(() => null);
    if (data) collect.add(f.path, data, kind);
  }
  return collect.finish();
}
