// Every step of every tour stored for a commit, by file: the code panel marks those lines, like CodeTour's gutter
// markers, so a tour can be found while reading the code. Free: only stored tours.
import { NextResponse } from "next/server";
import { errorResponse, repoAt } from "@/server/http";
import { tourMarks } from "@/server/trail/service";

export async function GET(req: Request) {
  try {
    const { owner, repo, sha, scope } = repoAt.parse(Object.fromEntries(new URL(req.url).searchParams));
    return NextResponse.json({ marks: await tourMarks({ owner, repo, sha, scope }) });
  } catch (error) {
    return errorResponse(error);
  }
}
