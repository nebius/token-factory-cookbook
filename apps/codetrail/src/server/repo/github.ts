// GitHub repositories: facts from the REST API (no AI), and the code itself as one tarball. Public repos come
// from codeload.github.com (no rate limit); private ones (self-hosted instances only) through the API with the token.
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { extract } from "tar-stream";
import { isImage, looksMinified, skipReason, type SkipReason } from "./filter";
import { findSecrets } from "./secrets";
import type { RepoRef } from "@/lib/ref";
import type { PullFacts, PullFile } from "@/lib/schemas";

export type RepoInfo = {
  owner: string;
  repo: string;
  description: string | null;
  stars: number;
  defaultBranch: string;
  /** The branch, tag or commit asked for (the default branch when none was). */
  ref: string;
  /** The commit everything is pinned to: tours are cached per commit. */
  sha: string;
  /** Whole repository on GitHub in KB, history included (a rough upper bound before download). */
  sizeKb: number;
  /** Bytes of code per language, from GitHub's linguist. */
  languages: Record<string, number>;
  /** Set on a read of only some folders (a scope string): it's stored apart from the full read. */
  scope?: string;
  htmlUrl: string;
  /** Only ever true on a self-hosted instance whose GITHUB_TOKEN can read the repo. */
  private: boolean;
};

export type RepoFile = { path: string; text: string; lines: number };
export type RepoImage = { path: string; mime: string; base64: string; bytes: number };
export type Snapshot = { files: RepoFile[]; images: RepoImage[]; skipped: { path: string; reason: SkipReason | "minified" | "secret" | "scope" }[] };

export class RepoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RepoError";
  }
}

type Fetch = typeof fetch;

function api(token: string | undefined, fetchImpl: Fetch) {
  const notFound = token ? "That repository doesn't exist, or the GITHUB_TOKEN can't read it." : "That repository doesn't exist or isn't public.";
  return async <T>(path: string, accept = "application/vnd.github+json"): Promise<T> => {
    const res = await fetchImpl(`https://api.github.com${path}`, {
      headers: { accept, "x-github-api-version": "2022-11-28", "user-agent": "codetrail", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404) throw new RepoError(notFound, 404);
    if (res.status === 403 || res.status === 429) throw new RepoError("GitHub's rate limit was reached. Try again in a few minutes.", 429);
    if (!res.ok) throw new RepoError(`GitHub returned ${res.status}.`, 502);
    return (accept.endsWith("json") ? await res.json() : await res.text()) as T;
  };
}

/**
 * Repository facts and the commit to pin to. Three small API calls, no download. Private repos are only
 * allowed when the caller says so (self-hosted instances, where nothing stored is shown to anyone else).
 */
export async function getRepoInfo(r: RepoRef, token?: string, allowPrivate = false, fetchImpl: Fetch = fetch): Promise<RepoInfo> {
  const gh = api(token, fetchImpl);
  const base = `/repos/${r.owner}/${r.repo}`;
  const meta = await gh<{
    name: string;
    owner: { login: string };
    description: string | null;
    stargazers_count: number;
    default_branch: string;
    size: number;
    private: boolean;
    html_url: string;
  }>(base);
  if (meta.private && !allowPrivate) {
    throw new RepoError("This repository is private. Private repos work on a self-hosted Codetrail whose GITHUB_TOKEN can read them.", 403);
  }
  const ref = r.ref ?? meta.default_branch;
  const [sha, languages] = await Promise.all([
    gh<string>(`${base}/commits/${encodeURIComponent(ref)}`, "application/vnd.github.sha"),
    gh<Record<string, number>>(`${base}/languages`).catch(() => ({})),
  ]);
  return {
    owner: meta.owner.login,
    repo: meta.name,
    description: meta.description,
    stars: meta.stargazers_count,
    defaultBranch: meta.default_branch,
    ref,
    sha: sha.trim(),
    sizeKb: meta.size,
    languages,
    htmlUrl: meta.html_url,
    private: meta.private,
  };
}

type ApiPull = {
  number: number;
  title: string;
  body: string | null;
  user: { login: string } | null;
  state: "open" | "closed";
  merged_at: string | null;
  draft?: boolean;
  base: { ref: string; sha: string; repo: { private: boolean } };
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  additions: number;
  deletions: number;
  changed_files: number;
  html_url: string;
};
type ApiPullFile = { filename: string; status: string; previous_filename?: string; additions: number; deletions: number; patch?: string };

/** A pull request and its changed files with their patches (GitHub lists up to 3,000; we keep the first 300). */
export async function getPullFacts(r: Pick<RepoRef, "owner" | "repo">, n: number, token?: string, allowPrivate = false, fetchImpl: Fetch = fetch): Promise<PullFacts> {
  const gh = api(token, fetchImpl);
  const base = `/repos/${r.owner}/${r.repo}/pulls/${n}`;
  const pr = await gh<ApiPull>(base).catch((e) => {
    throw e instanceof RepoError && e.status === 404 ? new RepoError(`There's no pull request #${n} in ${r.owner}/${r.repo}, or it isn't public.`, 404) : e;
  });
  if (pr.base.repo.private && !allowPrivate) throw new RepoError("This repository is private. Private repos work on a self-hosted Codetrail whose GITHUB_TOKEN can read them.", 403);
  const files: PullFile[] = [];
  for (let page = 1; page <= 3 && files.length < 300; page++) {
    const batch = await gh<ApiPullFile[]>(`${base}/files?per_page=100&page=${page}`);
    files.push(
      ...batch.map((f) => ({ path: f.filename, status: f.status, ...(f.previous_filename ? { previous: f.previous_filename } : {}), additions: f.additions, deletions: f.deletions, ...(f.patch ? { patch: f.patch } : {}) })),
    );
    if (batch.length < 100) break;
  }
  return {
    number: pr.number,
    title: pr.title,
    body: (pr.body ?? "").replace(/<!--[\s\S]*?-->/g, "").trim().slice(0, 4_000),
    author: pr.user?.login ?? "ghost",
    state: pr.merged_at ? "merged" : pr.state,
    draft: !!pr.draft,
    baseRef: pr.base.ref,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    headRepo: pr.head.repo?.full_name ?? null,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    htmlUrl: pr.html_url,
    files,
  };
}

/**
 * Text files at a commit, fetched one by one (a PR's changed files at its head, which may live in a fork).
 * Stops adding once `maxBytes` is reached; binary, minified and credential-like files are left out.
 */
export async function fetchFilesAt(repo: string, sha: string, paths: string[], opts: { token?: string; private?: boolean; maxBytes: number }, fetchImpl: Fetch = fetch): Promise<RepoFile[]> {
  const one = async (path: string): Promise<RepoFile | null> => {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const url = opts.private ? `https://api.github.com/repos/${repo}/contents/${encoded}?ref=${sha}` : `https://raw.githubusercontent.com/${repo}/${sha}/${encoded}`;
    const res = await fetchImpl(url, {
      headers: { "user-agent": "codetrail", ...(opts.private && opts.token ? { authorization: `Bearer ${opts.token}`, accept: "application/vnd.github.raw" } : {}) },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!res?.ok) return null;
    const text = await res.text();
    if (text.includes("\u0000") || looksMinified(text)) return null;
    return { path, text, lines: text.split("\n").length };
  };
  const out: RepoFile[] = [];
  let bytes = 0;
  // Six at a time, in priority order, until the byte budget is used.
  for (let i = 0; i < paths.length && bytes < opts.maxBytes; i += 6) {
    for (const f of await Promise.all(paths.slice(i, i + 6).map(one))) {
      if (!f || bytes + f.text.length > opts.maxBytes) continue;
      bytes += f.text.length;
      out.push(f);
    }
  }
  const secrets = await findSecrets(out);
  return out.filter((f) => !secrets.has(f.path));
}

/** How many commits `head` is ahead of `base` (one API call). */
export async function commitsAhead(r: Pick<RepoRef, "owner" | "repo">, base: string, head: string, token?: string, fetchImpl: Fetch = fetch): Promise<number> {
  const res = await api(token, fetchImpl)<{ ahead_by: number }>(`/repos/${r.owner}/${r.repo}/compare/${base}...${head}`);
  return res.ahead_by;
}

const MAX_TARBALL_BYTES = 200 * 1024 * 1024;
const MAX_IMAGES = 6;

const mimeOf = (path: string) => (/\.png$/i.test(path) ? "image/png" : /\.webp$/i.test(path) ? "image/webp" : "image/jpeg");

/**
 * Downloads the commit as a tarball and keeps the files worth reading. Everything else is listed in
 * `skipped` with the reason, so the UI can say exactly what wasn't read.
 */
export async function downloadSnapshot(info: Pick<RepoInfo, "owner" | "repo" | "sha" | "private">, token?: string, fetchImpl: Fetch = fetch): Promise<Snapshot> {
  // A private repo's tarball needs the token, through the API (which redirects to a signed download link).
  const url = info.private ? `https://api.github.com/repos/${info.owner}/${info.repo}/tarball/${info.sha}` : `https://codeload.github.com/${info.owner}/${info.repo}/tar.gz/${info.sha}`;
  const res = await fetchImpl(url, {
    headers: { "user-agent": "codetrail", ...(info.private && token ? { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } : {}) },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok || !res.body) throw new RepoError(`Couldn't download the repository (${res.status}).`, 502);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_TARBALL_BYTES) throw new RepoError("This repository is too large to download (over 200 MB).", 413);

  const collect = collector(info.repo);
  const tar = extract();
  let received = 0;

  const done = new Promise<void>((resolve, reject) => {
    tar.on("entry", (header, stream, next) => {
      // Paths start with "<owner>-<repo>-<sha>/": drop that folder.
      const path = header.name.split("/").slice(1).join("/");
      const kind = header.type === "file" && path ? collect.want(path, header.size ?? 0) : null;
      if (!kind) {
        stream.resume();
        stream.on("end", next);
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (c: unknown) => chunks.push(c as Buffer));
      stream.on("end", () => {
        collect.add(path, Buffer.concat(chunks), kind);
        next();
      });
    });
    tar.on("finish", resolve);
    tar.on("error", reject);
  });

  const body = Readable.fromWeb(res.body as never);
  body.on("data", (c: Buffer) => {
    received += c.length;
    if (received > MAX_TARBALL_BYTES) body.destroy(new RepoError("This repository is too large to download (over 200 MB).", 413));
  });
  body.pipe(createGunzip()).on("error", (e) => tar.destroy(e)).pipe(tar);
  await done;
  return collect.finish();
}

/**
 * Keeps the files worth reading, wherever they come from (a tarball, or a folder on disk): `want` decides from the
 * path and size (and lists what's skipped, with the reason), `add` takes the bytes, `finish` drops anything that
 * looks like a credential and picks the images.
 */
export function collector(repo: string) {
  const files: RepoFile[] = [];
  const imageCandidates: { path: string; bytes: number; data: Buffer }[] = [];
  const skipped: Snapshot["skipped"] = [];
  return {
    want(path: string, size: number): "text" | "image" | null {
      const reason = skipReason(path, size);
      if (reason === "binary" && isImage(path, size) && imageCandidates.length < 40) return "image";
      if (!reason) return "text";
      if (reason !== "ignored") skipped.push({ path, reason });
      return null;
    },
    add(path: string, data: Buffer, kind: "text" | "image") {
      if (kind === "image") return void imageCandidates.push({ path, bytes: data.length, data });
      const text = data.toString("utf8");
      if (text.includes("\u0000")) skipped.push({ path, reason: "binary" });
      else if (looksMinified(text)) skipped.push({ path, reason: "minified" });
      else files.push({ path, text, lines: text.split("\n").length });
    },
    async finish(): Promise<Snapshot> {
      // Anything that looks like a credential never reaches the model.
      const secrets = await findSecrets(files);
      for (const path of secrets) skipped.push({ path, reason: "secret" });
      const clean = files.filter((f) => !secrets.has(f.path));
      return { files: clean, images: pickImages(imageCandidates, clean, repo), skipped };
    },
  };
}

/**
 * Images most likely to explain the architecture: ones the README links to first, then ones whose
 * names say so (architecture, diagram, overview, flow), then anything under docs/.
 */
function pickImages(candidates: { path: string; bytes: number; data: Buffer }[], files: RepoFile[], repo: string): RepoImage[] {
  const readme = files.find((f) => /^readme\.mdx?$/i.test(f.path))?.text ?? "";
  const score = (p: string) => {
    const name = p.split("/").pop() ?? p;
    let s = 0;
    if (readme.includes(name)) s += 4;
    if (/architect|diagram|overview|flow|design|structure|pipeline/i.test(p)) s += 3;
    if (/(^|\/)docs?\//i.test(p)) s += 1;
    if (/logo|icon|badge|favicon|banner|sponsor|avatar|title|hero|cover|header|social|og-|preview|screenshot|demo/i.test(name)) s -= 5;
    // An image named after the project is its logo; images in examples and tests aren't about the architecture.
    if (name.toLowerCase().startsWith(repo.toLowerCase().replace(/\.js$/, ""))) s -= 5;
    if (/(^|\/)(examples?|samples?|demos?|tests?|__tests__|fixtures?|testdata|website|site)\//i.test(p)) s -= 5;
    return s;
  };
  return candidates
    .map((c) => ({ ...c, s: score(c.path) }))
    .filter((c) => c.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_IMAGES)
    .map((c) => ({ path: c.path, mime: mimeOf(c.path), base64: c.data.toString("base64"), bytes: c.bytes }));
}
