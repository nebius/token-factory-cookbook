// Search the files that were read, by path and by content, straight from the stored snapshot (no GitHub calls).
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, repoAt, refOf } from "@/server/http";
import { searchFiles } from "@/server/store";
import { commitKey, prepare } from "@/server/trail/service";

export type SearchHit = { path: string; line: number | null; text: string };

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const { owner, repo, sha, scope } = repoAt.parse(Object.fromEntries(url.searchParams));
    const q = z.string().trim().min(2).max(100).parse(url.searchParams.get("q"));
    const p = await prepare(refOf({ owner, repo, sha, scope }));
    const needle = q.toLowerCase();
    const hits: SearchHit[] = [];
    // Path matches first, then matching lines (at most 3 per file), 60 results in all. The full-text index
    // finds the files; the lines are picked here so each hit opens at the right place.
    for (const { path } of p.snapshot.files) if (path.toLowerCase().includes(needle) && hits.length < 30) hits.push({ path, line: null, text: path });
    for (const { path, text } of await searchFiles(commitKey(p), q)) {
      if (hits.length >= 60) break;
      let n = 0;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length && n < 3 && hits.length < 60; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          hits.push({ path, line: i + 1, text: lines[i].trim().slice(0, 160) });
          n++;
        }
      }
    }
    return NextResponse.json({ hits: hits.slice(0, 60) });
  } catch (error) {
    return errorResponse(error);
  }
}
