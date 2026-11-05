// Site-wide totals for the landing page counter.
import { NextResponse } from "next/server";
import { siteTotals } from "@/server/stats";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await siteTotals(), { headers: { "cache-control": "public, max-age=10, stale-while-revalidate=30" } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Stats unavailable." }, { status: 503 });
  }
}
