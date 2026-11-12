// Tours from the repo's earlier read: GET says how many could come along, POST brings them, each step checked again
// against this commit. Free (no model call).
import { NextResponse } from "next/server";
import { errorResponse, repoAt, refOf } from "@/server/http";
import { carryable, carryTours, getStoredAtlas, getTourIndex, prepare } from "@/server/trail/service";

export async function GET(req: Request) {
  try {
    const q = Object.fromEntries(new URL(req.url).searchParams);
    const p = await prepare(refOf(repoAt.parse(q)));
    return NextResponse.json({ carry: await carryable(p) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const p = await prepare(refOf(repoAt.parse(await req.json())));
    // Only on a commit already read: this never starts a read.
    const atlas = await getStoredAtlas(p.info);
    if (!atlas) return NextResponse.json({ error: "Read this commit first." }, { status: 400 });
    const carried = await carryTours(p, atlas);
    return NextResponse.json({ carried, tours: await getTourIndex(p.info) });
  } catch (error) {
    return errorResponse(error);
  }
}
