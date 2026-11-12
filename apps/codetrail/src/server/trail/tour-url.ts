// "Open a tour from a URL": a CodeTour file shared as a GitHub file or a gist, fetched by the server, checked against
// this commit like an imported tour, and saved as one of the tours written here. Only GitHub's own hosts are fetched
// (raw files, blob pages turned into raw links, and raw gists), so the server never reaches anywhere else. Free.
import type { Atlas, Tour, TourIndexEntry } from "@/lib/schemas";
import { RepoError } from "@/server/repo/github";
import { putJSON } from "@/server/store";
import { codeTourToTour, commitKey, getTourIndex, type CodeTourFile, type Prepared } from "./service";

const MAX_BYTES = 1_000_000;

/** The raw URL to fetch for a shared tour link, or null when it isn't a GitHub file or gist. */
export function tourUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (u.hostname === "raw.githubusercontent.com" && parts.length >= 4) return u.origin + u.pathname;
  if (u.hostname === "gist.githubusercontent.com" && parts.length >= 3 && parts[2] === "raw") return u.origin + u.pathname;
  // github.com/owner/repo/blob/ref/path → the same file on raw.githubusercontent.com
  if (u.hostname === "github.com" && parts.length >= 5 && parts[2] === "blob") return `https://raw.githubusercontent.com/${[parts[0], parts[1], ...parts.slice(3)].join("/")}`;
  return null;
}

export async function importTourFromUrl(p: Prepared, atlas: Atlas, link: string): Promise<{ tour: Tour; tours: TourIndexEntry[] }> {
  const url = tourUrl(link);
  if (!url) throw new RepoError("Use a link to a .tour file on GitHub (a file or raw link) or a raw gist link.", 400);
  const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res?.ok) throw new RepoError(`Couldn't fetch that tour (${res ? res.status : "no response"}).`, 400);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new RepoError("That file is too big to be a tour.", 400);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new RepoError("That file is too big to be a tour.", 400);
  let ct: CodeTourFile;
  try {
    ct = JSON.parse(text) as CodeTourFile;
  } catch {
    throw new RepoError("That link isn't a CodeTour file (it isn't JSON).", 400);
  }
  if (!ct || typeof ct !== "object") throw new RepoError("That link isn't a CodeTour file.", 400);
  const nodes = atlas.nodes.map((n) => ({ id: n.id, files: n.files }));
  const tour = codeTourToTour(ct, `${url}#${Date.now()}`, p.files, nodes, "custom");
  if (!tour) throw new RepoError("Fewer than two of its steps point at code in this commit, so it can't be shown here.", 400);
  await putJSON(`${commitKey(p)}/tours/${tour.id}.json`, tour);
  const tours = [...(await getTourIndex(p.info)), { id: tour.id, title: tour.title, question: tour.question, steps: tour.steps.length, cost: 0, at: Date.now(), source: "custom" as const }];
  await putJSON(`${commitKey(p)}/tours.json`, tours);
  return { tour, tours };
}
