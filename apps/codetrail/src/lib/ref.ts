// Turns whatever someone pastes into owner/repo (+ an optional branch, tag or commit).
// No server-only import: the browser uses it to route `/owner/repo` before anything is fetched.

export type RepoRef = { owner: string; repo: string; ref?: string; path?: string; pull?: number; /** Folders read, as a scope string (src/lib/scope.ts). */ scope?: string };

const NAME = /^[A-Za-z0-9_.-]+$/;

/** The owner local folders go under (self-hosted). GitHub usernames can't contain "_", so it never clashes. */
export const LOCAL_OWNER = "_local";

/** A Markdown link, or just the text when there's nowhere to link to. */
export const mdLink = (text: string, url: string | null) => (url ? `[${text}](${url})` : text);

/** A file's page on GitHub, or null for a local folder (it has none). */
export const blobUrl = (owner: string, repo: string, sha: string, path: string, start?: number, end?: number) =>
  owner === LOCAL_OWNER
    ? null
    : `https://github.com/${owner}/${repo}/blob/${sha}/${path.split("/").map(encodeURIComponent).join("/")}${start ? `#L${start}${end && end !== start ? `-L${end}` : ""}` : ""}`;

/**
 * Accepts "owner/repo", "github.com/owner/repo", full https URLs (with /tree/<ref>/..., /blob/<ref>/...,
 * /commit/<sha>), pull requests (/pull/123, "owner/repo#123"), "owner/repo@ref", and git remotes such as
 * "git@github.com:owner/repo.git".
 * Returns null for anything that isn't a GitHub repository.
 */
export function parseRepoInput(input: string): RepoRef | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^git@github\.com:/i, "github.com/").replace(/^(git\+)?(https?|ssh|git):\/\//i, "").replace(/^(www\.)?github\.com\//i, "");
  if (/^[a-z0-9-]+\.[a-z]{2,}\//i.test(s)) return null; // Another host (gitlab.com/…).
  const short = s.match(/^([^/#]+\/[^/#]+)#(\d+)$/);
  if (short) s = `${short[1]}/pull/${short[2]}`;
  s = s.replace(/[?#].*$/, "").replace(/\/+$/, "");

  let ref: string | undefined;
  const at = s.match(/^([^/]+\/[^/@]+)@(.+)$/);
  if (at) {
    s = at[1];
    ref = at[2];
  }
  const [owner, rawRepo, kind, ...rest] = s.split("/");
  if (!owner || !rawRepo) return null;
  const repo = rawRepo.replace(/\.git$/i, "");
  if (!NAME.test(owner) || !NAME.test(repo)) return null;
  if (!ref && (kind === "tree" || kind === "blob" || kind === "commit") && rest[0]) ref = rest[0];
  // A file link (blob/<ref>/<path>) also names the file to open.
  const path = kind === "blob" && rest.length > 1 ? rest.slice(1).join("/") : undefined;
  const pull = kind === "pull" && /^\d{1,7}$/.test(rest[0] ?? "") ? Number(rest[0]) : undefined;
  return { owner, repo, ...(ref ? { ref } : {}), ...(path ? { path } : {}), ...(pull ? { pull } : {}) };
}
