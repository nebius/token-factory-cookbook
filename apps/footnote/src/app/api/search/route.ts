import { NextResponse } from "next/server";
import { openDb, searchCells } from "@/lib/db";

export const runtime = "nodejs";

// Cells across every run, by label, quote or value: the start page's "Search your runs".
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ hits: searchCells(openDb().db, q) }, { headers: { "Cache-Control": "no-store" } });
}
