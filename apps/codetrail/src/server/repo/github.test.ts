import { describe, expect, it } from "vitest";
import { downloadSnapshot, getRepoInfo } from "./github";

const meta = (isPrivate: boolean) => ({ name: "app", owner: { login: "acme" }, description: null, stargazers_count: 1, default_branch: "main", size: 10, private: isPrivate, html_url: "https://github.com/acme/app" });

/** A fake GitHub: repo facts, a commit SHA, languages, and records the tarball request. */
function fakeGitHub(isPrivate: boolean) {
  const seen: { url: string; auth: string | null }[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization");
    seen.push({ url, auth });
    if (url.endsWith("/repos/acme/app")) return new Response(JSON.stringify(meta(isPrivate)));
    if (url.includes("/commits/")) return new Response("a".repeat(40));
    if (url.endsWith("/languages")) return new Response("{}");
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

describe("private repos", () => {
  it("are refused unless the instance allows them", async () => {
    const { fetchImpl } = fakeGitHub(true);
    await expect(getRepoInfo({ owner: "acme", repo: "app" }, "tok", false, fetchImpl)).rejects.toThrow(/private/i);
    const info = await getRepoInfo({ owner: "acme", repo: "app" }, "tok", true, fetchImpl);
    expect(info).toMatchObject({ private: true, sha: "a".repeat(40), ref: "main" });
  });

  it("explain a 404 differently when a token is set", async () => {
    const missing = (async () => new Response("", { status: 404 })) as typeof fetch;
    await expect(getRepoInfo({ owner: "x", repo: "y" }, undefined, false, missing)).rejects.toThrow("isn't public");
    await expect(getRepoInfo({ owner: "x", repo: "y" }, "tok", false, missing)).rejects.toThrow("GITHUB_TOKEN can't read it");
  });

  it("download through the API with the token; public ones from codeload without it", async () => {
    const priv = fakeGitHub(true);
    await expect(downloadSnapshot({ owner: "acme", repo: "app", sha: "s1", private: true }, "tok", priv.fetchImpl)).rejects.toThrow();
    expect(priv.seen.at(-1)).toEqual({ url: "https://api.github.com/repos/acme/app/tarball/s1", auth: "Bearer tok" });

    const pub = fakeGitHub(false);
    await expect(downloadSnapshot({ owner: "acme", repo: "app", sha: "s1", private: false }, "tok", pub.fetchImpl)).rejects.toThrow();
    expect(pub.seen.at(-1)).toEqual({ url: "https://codeload.github.com/acme/app/tar.gz/s1", auth: null });
  });
});
